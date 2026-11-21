import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createContainer } from "../../container.js";
import { createApp } from "../../app.js";
import { TEST_CONFIG, fakeClerkVerifier } from "../helpers/testApp.js";

// Real identity resolver (no injected test principal): the demo endpoint, and every
// /api route refusing callers without a verified credential.

let prisma;
let container;
let app;

beforeEach(() => {
  prisma = {
    user: {
      upsert: vi.fn().mockResolvedValue({ id: "u-demo", clerkId: "demo" }),
      findUnique: vi.fn().mockResolvedValue({ id: "u-ada", name: "Ada", email: "a@x", clerkId: "clerk_ada" }),
    },
    session: { findMany: vi.fn().mockResolvedValue([]) },
    interview: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  container = createContainer({ config: TEST_CONFIG, prisma, clerkVerifier: fakeClerkVerifier() });
  app = createApp(container, { demoRateLimit: { limit: 3, windowMs: 60_000 } });
});

describe("POST /api/auth/demo", () => {
  it("returns a demo token the server accepts, with an ISO expiry", async () => {
    const res = await request(app).post("/api/auth/demo");
    expect(res.status).toBe(200);
    expect(await container.auth.demoTokens.verify(res.body.token)).toBe(true);
    expect(new Date(res.body.expiresAt).toISOString()).toBe(res.body.expiresAt);
  });

  it("is rate-limited per client", async () => {
    for (let i = 0; i < 3; i++) await request(app).post("/api/auth/demo");
    const res = await request(app).post("/api/auth/demo");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ message: "Too many requests, please try again later" });
  });
});

describe("authentication on /api", () => {
  it("refuses a request without credentials", async () => {
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("refuses the old x-clerk-id header", async () => {
    const res = await request(app).get("/api/sessions").set("x-clerk-id", "clerk_ada");
    expect(res.status).toBe(401);
  });

  it("accepts a demo token from the demo endpoint", async () => {
    const { body } = await request(app).post("/api/auth/demo");
    const res = await request(app).get("/api/sessions").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(200);
  });

  it("accepts a verified Clerk session", async () => {
    const res = await request(app).get("/api/sessions").set("Authorization", "Bearer clerk:clerk_ada");
    expect(res.status).toBe(200);
  });

  it("keeps /health open", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
  });
});
