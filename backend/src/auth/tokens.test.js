import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { createDemoTokens } from "./demoTokens.js";
import { generateInviteSecret, hashInviteSecret } from "./inviteSecrets.js";
import { INTERVIEWER, DEMO, CANDIDATE, isOwnerKind } from "./principal.js";

const SECRET = "test-demo-secret-0123456789abcdef0123";
const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

describe("demo tokens", () => {
  it("issues a token that verifies, with an ISO expiry 8 hours later", async () => {
    const tokens = createDemoTokens({ secret: SECRET, now: () => T0 });
    const { token, expiresAt } = await tokens.issue();
    expect(await tokens.verify(token)).toBe(true);
    expect(expiresAt).toBe(new Date(T0 + EIGHT_HOURS_MS).toISOString());
  });

  it("rejects a tampered token", async () => {
    const tokens = createDemoTokens({ secret: SECRET, now: () => T0 });
    const { token } = await tokens.issue();
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(await tokens.verify(tampered)).toBe(false);
  });

  it("rejects a token signed with another secret", async () => {
    const other = createDemoTokens({ secret: "another-secret-0123456789abcdef0123", now: () => T0 });
    const { token } = await other.issue();
    expect(await createDemoTokens({ secret: SECRET, now: () => T0 }).verify(token)).toBe(false);
  });

  it("rejects a token once 8 hours have passed", async () => {
    let now = T0;
    const tokens = createDemoTokens({ secret: SECRET, now: () => now });
    const { token } = await tokens.issue();
    now = T0 + EIGHT_HOURS_MS + 1000;
    expect(await tokens.verify(token)).toBe(false);
  });

  it("rejects a correctly signed token for another audience", async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("demo")
      .setAudience("something-else")
      .setIssuedAt(Math.floor(T0 / 1000))
      .setExpirationTime(Math.floor(T0 / 1000) + 3600)
      .sign(new TextEncoder().encode(SECRET));
    expect(await createDemoTokens({ secret: SECRET, now: () => T0 }).verify(forged)).toBe(false);
  });

  it("never throws on garbage", async () => {
    const tokens = createDemoTokens({ secret: SECRET });
    expect(await tokens.verify("not.a.jwt")).toBe(false);
    expect(await tokens.verify("")).toBe(false);
    expect(await tokens.verify(undefined)).toBe(false);
  });
});

describe("invite secrets", () => {
  it("generates a 43-char base64url secret and its SHA-256 hex hash", () => {
    const { secret, hash } = generateInviteSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteSecret(secret)).toBe(hash);
  });

  it("never generates the same secret twice", () => {
    expect(generateInviteSecret().secret).not.toBe(generateInviteSecret().secret);
  });
});

describe("principal kinds", () => {
  it("treats interviewers and demo visitors as owners, candidates not", () => {
    expect(isOwnerKind({ kind: INTERVIEWER })).toBe(true);
    expect(isOwnerKind({ kind: DEMO })).toBe(true);
    expect(isOwnerKind({ kind: CANDIDATE })).toBe(false);
    expect(isOwnerKind(undefined)).toBe(false);
  });
});
