import { describe, it, expect, vi, beforeEach } from "vitest";
import { createIdentityResolver } from "./identityResolver.js";
import { authenticate, requireKind } from "./middleware.js";
import { createDemoTokens } from "./demoTokens.js";
import { hashInviteSecret } from "./inviteSecrets.js";
import { errorHandler } from "../shared/errorHandler.js";

const SECRET = "test-demo-secret-0123456789abcdef0123";
const ADA = { id: "u-ada", name: "Ada", email: "ada@x.dev", clerkId: "clerk_ada" };

let clerkVerifier;
let userRepository;
let interviewRepository;
let demoTokens;
let resolver;

beforeEach(() => {
  clerkVerifier = {
    verify: vi.fn(async (token) => (token.startsWith("clerk:") ? { clerkId: token.slice(6) } : null)),
    fetchUser: vi.fn(async () => ({ name: "Grace", email: "grace@x.dev", profileImage: "img" })),
  };
  userRepository = {
    findIdentityByClerkId: vi.fn(async (clerkId) => (clerkId === ADA.clerkId ? ADA : null)),
    createFromClerk: vi.fn(async (data) => ({ id: "u-new", ...data })),
    upsertDemoUser: vi.fn(async () => ({ id: "u-demo", clerkId: "demo" })),
  };
  interviewRepository = { findByInviteHash: vi.fn(async () => null) };
  demoTokens = createDemoTokens({ secret: SECRET });
  resolver = createIdentityResolver({ clerkVerifier, demoTokens, userRepository, interviewRepository });
});

const headers = (h) => {
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name) => lower[name.toLowerCase()] };
};

describe("identity resolver", () => {
  it("resolves a valid demo token to the demo principal", async () => {
    const { token } = await demoTokens.issue();
    expect(await resolver.fromCredentials({ bearer: token })).toEqual({ kind: "demo", userId: "u-demo", clerkId: "demo" });
    expect(clerkVerifier.verify).not.toHaveBeenCalled();
  });

  it("resolves a verified Clerk session of a known user to an interviewer", async () => {
    expect(await resolver.fromCredentials({ bearer: "clerk:clerk_ada" })).toEqual({
      kind: "interviewer",
      userId: "u-ada",
      clerkId: "clerk_ada",
    });
  });

  it("provisions a missing user from Clerk", async () => {
    const principal = await resolver.fromCredentials({ bearer: "clerk:clerk_grace" });
    expect(clerkVerifier.fetchUser).toHaveBeenCalledWith("clerk_grace");
    expect(userRepository.createFromClerk).toHaveBeenCalledWith({
      clerkId: "clerk_grace",
      name: "Grace",
      email: "grace@x.dev",
      profileImage: "img",
    });
    expect(principal).toEqual({ kind: "interviewer", userId: "u-new", clerkId: "clerk_grace" });
  });

  it("falls back to a placeholder e-mail when Clerk has none", async () => {
    clerkVerifier.fetchUser.mockResolvedValue({ name: "No Mail", email: null, profileImage: null });
    await resolver.fromCredentials({ bearer: "clerk:clerk_nomail" });
    expect(userRepository.createFromClerk).toHaveBeenCalledWith(
      expect.objectContaining({ email: "clerk_nomail@talentiq.dev" }),
    );
  });

  it("returns null for a bearer that is neither demo nor Clerk", async () => {
    expect(await resolver.fromCredentials({ bearer: "garbage" })).toBeNull();
  });

  it("resolves a matching invite to a candidate principal for that interview", async () => {
    interviewRepository.findByInviteHash.mockResolvedValue({ id: "iv-1", status: "scheduled" });
    expect(await resolver.fromCredentials({ invite: "s3cret" })).toEqual({ kind: "candidate", interviewId: "iv-1" });
    expect(interviewRepository.findByInviteHash).toHaveBeenCalledWith(hashInviteSecret("s3cret"));
  });

  it.each(["completed", "cancelled"])("refuses an invite once the interview is %s", async (status) => {
    interviewRepository.findByInviteHash.mockResolvedValue({ id: "iv-1", status });
    expect(await resolver.fromCredentials({ invite: "s3cret" })).toBeNull();
  });

  it("returns null without any credential", async () => {
    expect(await resolver.fromCredentials({})).toBeNull();
  });

  it("reads Authorization and x-invite-token from a request, and ignores the old x-clerk-id header", async () => {
    expect(await resolver.fromRequest(headers({ "x-clerk-id": "clerk_ada" }))).toBeNull();
    expect(await resolver.fromRequest(headers({ Authorization: "Bearer clerk:clerk_ada" }))).toMatchObject({ kind: "interviewer" });
    interviewRepository.findByInviteHash.mockResolvedValue({ id: "iv-9", status: "live" });
    expect(await resolver.fromRequest(headers({ "x-invite-token": "abc" }))).toEqual({ kind: "candidate", interviewId: "iv-9" });
  });
});

// ── Middleware, through the real error handler ───────────────────────────────

const run = async (middleware, req) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  let passed = false;
  await middleware(req, res, (err) => {
    if (err) errorHandler(err, req, res, () => {});
    else passed = true;
  });
  return { passed, status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

describe("authenticate / requireKind", () => {
  it("attaches the principal", async () => {
    const req = headers({ Authorization: "Bearer clerk:clerk_ada" });
    const out = await run(authenticate(resolver), req);
    expect(out.passed).toBe(true);
    expect(req.principal).toMatchObject({ kind: "interviewer", userId: "u-ada" });
  });

  it("answers 401 Unauthorized without a valid credential", async () => {
    const out = await run(authenticate(resolver), headers({}));
    expect(out).toMatchObject({ passed: false, status: 401, body: { message: "Unauthorized" } });
  });

  it("answers 500 Auth error when resolution itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    userRepository.findIdentityByClerkId.mockRejectedValue(new Error("db down"));
    const out = await run(authenticate(resolver), headers({ Authorization: "Bearer clerk:clerk_ada" }));
    expect(out).toMatchObject({ passed: false, status: 500, body: { message: "Auth error" } });
  });

  it("requireKind lets allowed kinds through and answers 403 Forbidden otherwise", async () => {
    const allowed = await run(requireKind("interviewer", "demo"), { principal: { kind: "demo" } });
    expect(allowed.passed).toBe(true);
    const denied = await run(requireKind("interviewer", "demo"), { principal: { kind: "candidate", interviewId: "x" } });
    expect(denied).toMatchObject({ passed: false, status: 403, body: { message: "Forbidden" } });
  });
});
