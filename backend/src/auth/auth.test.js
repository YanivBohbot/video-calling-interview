import { describe, it, expect, vi } from "vitest";
import { createClerkHeaderStrategy } from "./clerkHeaderStrategy.js";
import { requireIdentity } from "./requireIdentity.js";
import { errorHandler } from "../shared/errorHandler.js";

const USER = { id: "u1", name: "Ada", email: "ada@x.dev", clerkId: "clerk_1" };

const fakeReq = (headers = {}) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name) => lower[name.toLowerCase()] };
};

// Runs the middleware and, on error, the real error handler — returns what the client sees.
const run = async (strategy, req) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  let passed = false;
  await requireIdentity(strategy)(req, res, (err) => {
    if (err) errorHandler(err, req, res, () => {});
    else passed = true;
  });
  return { passed, status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
};

describe("clerk header strategy + requireIdentity", () => {
  it("sets req.user from a known x-clerk-id", async () => {
    const findUserByClerkId = vi.fn().mockResolvedValue(USER);
    const req = fakeReq({ "x-clerk-id": "clerk_1" });
    const out = await run(createClerkHeaderStrategy({ findUserByClerkId }), req);
    expect(out.passed).toBe(true);
    expect(findUserByClerkId).toHaveBeenCalledWith("clerk_1");
    expect(req.user).toEqual({ id: "u1", name: "Ada", email: "ada@x.dev", clerkID: "clerk_1" });
  });

  it("rejects an unknown x-clerk-id with 401 Invalid clerk id", async () => {
    const strategy = createClerkHeaderStrategy({ findUserByClerkId: vi.fn().mockResolvedValue(null) });
    const out = await run(strategy, fakeReq({ "x-clerk-id": "nope" }));
    expect(out).toMatchObject({ passed: false, status: 401, body: { message: "Invalid clerk id" } });
  });

  it("falls back to Authorization: Bearer user:<clerkId>", async () => {
    const findUserByClerkId = vi.fn().mockResolvedValue(USER);
    const req = fakeReq({ Authorization: "Bearer user:abc" });
    const out = await run(createClerkHeaderStrategy({ findUserByClerkId }), req);
    expect(out.passed).toBe(true);
    expect(findUserByClerkId).toHaveBeenCalledWith("abc");
  });

  it("answers 401 Unauthorized with no identity at all", async () => {
    const findUserByClerkId = vi.fn();
    const out = await run(createClerkHeaderStrategy({ findUserByClerkId }), fakeReq());
    expect(out).toMatchObject({ passed: false, status: 401, body: { message: "Unauthorized" } });
    expect(findUserByClerkId).not.toHaveBeenCalled();
  });

  it("turns a lookup failure into a 500 Auth error without details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const strategy = createClerkHeaderStrategy({ findUserByClerkId: vi.fn().mockRejectedValue(new Error("db down")) });
    const out = await run(strategy, fakeReq({ "x-clerk-id": "clerk_1" }));
    expect(out).toMatchObject({ passed: false, status: 500, body: { message: "Auth error" } });
  });
});
