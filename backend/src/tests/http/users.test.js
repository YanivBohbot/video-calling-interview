import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, authAs, PRINCIPALS } from "../helpers/testApp.js";
import { createUserService } from "../../services/user.service.js";
import { USER_SELECT } from "../../repositories/user.repository.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";

const { ada, bob, candidateOf } = PRINCIPALS;

// ── Service rules, with a fake repository ─────────────────────────────────────

const fakeRepo = (overrides = {}) => ({
  findByClerkId: vi.fn(),
  upsertProfile: vi.fn().mockResolvedValue({ id: "u-ada" }),
  countInterviewStats: vi.fn(),
  ...overrides,
});

describe("userService", () => {
  it("getMe reads the caller's own row", async () => {
    const repo = fakeRepo({ findByClerkId: vi.fn().mockResolvedValue({ id: "u-ada" }) });
    await createUserService({ userRepository: repo }).getMe(ada);
    expect(repo.findByClerkId).toHaveBeenCalledWith("clerk_ada");
  });

  it("getMe answers 404 User not found if the row vanished", async () => {
    const repo = fakeRepo({ findByClerkId: vi.fn().mockResolvedValue(null) });
    await expect(createUserService({ userRepository: repo }).getMe(ada)).rejects.toEqual(new NotFoundError("User not found"));
  });

  it("updateMe requires a name", async () => {
    await expect(createUserService({ userRepository: fakeRepo() }).updateMe(ada, {})).rejects.toEqual(
      new ValidationError("Name is required"),
    );
  });

  it("updateMe applies the historical defaults to the caller only", async () => {
    const repo = fakeRepo();
    await createUserService({ userRepository: repo }).updateMe(ada, { name: "Ada" });
    const defaults = { name: "Ada", title: "", bio: "", phone: "", timezone: "UTC" };
    expect(repo.upsertProfile).toHaveBeenCalledWith("clerk_ada", {
      update: defaults,
      create: { clerkId: "clerk_ada", email: "clerk_ada@talentiq.dev", ...defaults },
    });
  });

  it("updateMe maps a duplicate email to 409 Email already in use", async () => {
    const repo = fakeRepo({ upsertProfile: vi.fn().mockRejectedValue(new ConflictError()) });
    const err = await createUserService({ userRepository: repo }).updateMe(ada, { name: "A" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("Email already in use");
  });

  it("getMyStats averages completed durations, counting a missing one as 60", async () => {
    const repo = fakeRepo({
      countInterviewStats: vi.fn().mockResolvedValue({
        total: 5, completed: 3, scheduled: 1, cancelled: 1, live: 0, durations: [30, null, 45],
      }),
    });
    expect(await createUserService({ userRepository: repo }).getMyStats(ada)).toEqual({
      total: 5, completed: 3, scheduled: 1, cancelled: 1, live: 0, avgDuration: 45,
    });
    expect(repo.countInterviewStats).toHaveBeenCalledWith("u-ada");
  });
});

// ── HTTP contract ─────────────────────────────────────────────────────────────

let prisma;
let app;
let rows;

beforeEach(() => {
  rows = {
    clerk_ada: { id: "u-ada", clerkId: "clerk_ada", name: "Ada", email: "ada@x.dev" },
    clerk_bob: { id: "u-bob", clerkId: "clerk_bob", name: "Bob", email: "bob@x.dev" },
  };
  prisma = {
    user: {
      findUnique: vi.fn(async ({ where }) => rows[where.clerkId] ?? null),
      upsert: vi.fn(async ({ where, update }) => Object.assign(rows[where.clerkId], update)),
    },
    interview: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  };
  ({ app } = buildTestApp({ prisma, principal: ada }));
});

describe("users HTTP contract", () => {
  it("GET /api/users/me returns the caller's profile in Mongo shape", async () => {
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ _id: "u-ada", clerkID: "clerk_ada", name: "Ada", email: "ada@x.dev" });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { clerkId: "clerk_ada" }, select: USER_SELECT });
  });

  it("PUT /api/users/me changes only the caller", async () => {
    const res = await request(app).put("/api/users/me").send({ name: "Ada L." });
    expect(res.status).toBe(200);
    expect(rows.clerk_ada.name).toBe("Ada L.");
    expect(rows.clerk_bob.name).toBe("Bob");
  });

  it("GET /api/users/me/stats is the caller's stats", async () => {
    const res = await request(app).get("/api/users/me/stats").set(authAs(bob));
    expect(res.body).toEqual({ total: 0, completed: 0, scheduled: 0, cancelled: 0, live: 0, avgDuration: 0 });
    expect(prisma.interview.count).toHaveBeenCalledWith({ where: { interviewerId: "u-bob" } });
  });

  it("no longer serves the user list, user creation or other people's profiles", async () => {
    expect((await request(app).get("/api/users")).status).toBe(404);
    expect((await request(app).post("/api/users").send({ name: "x", email: "x@x", clerkID: "x" })).status).toBe(404);
    expect((await request(app).get("/api/users/by-clerk/clerk_bob")).status).toBe(404);
    expect((await request(app).put("/api/users/by-clerk/clerk_bob").send({ name: "pwned" })).status).toBe(404);
    expect(rows.clerk_bob.name).toBe("Bob");
  });

  it("is closed to candidates", async () => {
    const res = await request(app).get("/api/users/me").set(authAs(candidateOf("iv-1")));
    expect(res.status).toBe(403);
  });

  it("PUT hides unexpected failures behind 500 Update failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.user.upsert.mockRejectedValue(new Error("db exploded"));
    const res = await request(app).put("/api/users/me").send({ name: "Ada" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Update failed" });
  });
});
