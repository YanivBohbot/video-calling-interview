import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "./testApp.js";
import { createUserService } from "../services/user.service.js";
import { USER_SELECT } from "../repositories/user.repository.js";
import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";

const ZERO_STATS = { total: 0, completed: 0, scheduled: 0, cancelled: 0, live: 0, avgDuration: 0 };

// ── Service rules, with a fake repository ─────────────────────────────────────

const fakeRepo = (overrides = {}) => ({
  findAll: vi.fn(),
  findByClerkId: vi.fn(),
  findIdentityByClerkId: vi.fn(),
  create: vi.fn(),
  upsertProfile: vi.fn(),
  upsertDemoUser: vi.fn(),
  countInterviewStats: vi.fn(),
  ...overrides,
});

describe("userService", () => {
  it("createUser requires name, email and clerkID", async () => {
    const service = createUserService({ userRepository: fakeRepo() });
    await expect(service.createUser({ name: "A", email: "a@x" })).rejects.toEqual(
      new ValidationError("Missing required user fields"),
    );
  });

  it("createUser maps a duplicate to 409 User exists", async () => {
    const userRepository = fakeRepo({ create: vi.fn().mockRejectedValue(new ConflictError()) });
    const service = createUserService({ userRepository });
    const err = await service.createUser({ name: "A", email: "a@x", clerkID: "c" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("User exists");
  });

  it("createUser stores clerkID as clerkId", async () => {
    const userRepository = fakeRepo({ create: vi.fn().mockResolvedValue({ id: "u1" }) });
    await createUserService({ userRepository }).createUser({ name: "A", email: "a@x", clerkID: "c", profileImage: "p" });
    expect(userRepository.create).toHaveBeenCalledWith({ name: "A", email: "a@x", clerkId: "c", profileImage: "p" });
  });

  it("getByClerkId answers 404 User not found", async () => {
    const service = createUserService({ userRepository: fakeRepo({ findByClerkId: vi.fn().mockResolvedValue(null) }) });
    await expect(service.getByClerkId("x")).rejects.toEqual(new NotFoundError("User not found"));
  });

  it("updateProfile requires a name", async () => {
    const service = createUserService({ userRepository: fakeRepo() });
    await expect(service.updateProfile("c", {})).rejects.toEqual(new ValidationError("Name is required"));
  });

  it("updateProfile applies the historical defaults", async () => {
    const userRepository = fakeRepo({ upsertProfile: vi.fn().mockResolvedValue({ id: "u1" }) });
    await createUserService({ userRepository }).updateProfile("c1", { name: "Ada" });
    const defaults = { name: "Ada", title: "", bio: "", phone: "", timezone: "UTC" };
    expect(userRepository.upsertProfile).toHaveBeenCalledWith("c1", {
      update: defaults,
      create: { clerkId: "c1", email: "c1@talentiq.dev", ...defaults },
    });
  });

  it("updateProfile only sets profileImage when given", async () => {
    const userRepository = fakeRepo({ upsertProfile: vi.fn().mockResolvedValue({ id: "u1" }) });
    await createUserService({ userRepository }).updateProfile("c1", { name: "Ada", email: "a@x", profileImage: "img" });
    const [, { update, create }] = userRepository.upsertProfile.mock.calls[0];
    expect(update.profileImage).toBe("img");
    expect(create).toMatchObject({ email: "a@x", profileImage: "img" });
  });

  it("updateProfile maps a duplicate email to 409 Email already in use", async () => {
    const userRepository = fakeRepo({ upsertProfile: vi.fn().mockRejectedValue(new ConflictError()) });
    const err = await createUserService({ userRepository }).updateProfile("c", { name: "A" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("Email already in use");
  });

  it("getStats returns zeros for an unknown user", async () => {
    const service = createUserService({ userRepository: fakeRepo({ findByClerkId: vi.fn().mockResolvedValue(null) }) });
    expect(await service.getStats("nobody")).toEqual(ZERO_STATS);
  });

  it("getStats averages completed durations, counting a missing one as 60", async () => {
    const userRepository = fakeRepo({
      findByClerkId: vi.fn().mockResolvedValue({ id: "u1" }),
      countInterviewStats: vi.fn().mockResolvedValue({
        total: 5, completed: 3, scheduled: 1, cancelled: 1, live: 0, durations: [30, null, 45],
      }),
    });
    expect(await createUserService({ userRepository }).getStats("c1")).toEqual({
      total: 5, completed: 3, scheduled: 1, cancelled: 1, live: 0, avgDuration: 45,
    });
    expect(userRepository.countInterviewStats).toHaveBeenCalledWith("u1");
  });

  it("resolveInterviewerId upserts the demo user", async () => {
    const userRepository = fakeRepo({ upsertDemoUser: vi.fn().mockResolvedValue({ id: "demo-id" }) });
    expect(await createUserService({ userRepository }).resolveInterviewerId("demo")).toBe("demo-id");
  });

  it("resolveInterviewerId returns null for empty or unknown ids", async () => {
    const userRepository = fakeRepo({ findByClerkId: vi.fn().mockResolvedValue(null) });
    const service = createUserService({ userRepository });
    expect(await service.resolveInterviewerId(undefined)).toBeNull();
    expect(await service.resolveInterviewerId("ghost")).toBeNull();
  });
});

// ── HTTP contract, real module over a stub prisma ────────────────────────────

let prisma;
let app;

beforeEach(() => {
  prisma = {
    user: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    interview: { count: vi.fn(), findMany: vi.fn() },
  };
  ({ app } = buildTestApp({ prisma }));
});

describe("users HTTP contract", () => {
  it("GET /api/users lists newest first in Mongo shape", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: "u1", clerkId: "c1", name: "A" }]);
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ _id: "u1", clerkID: "c1", name: "A" }]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" }, select: USER_SELECT });
  });

  it("USER_SELECT keeps exactly the historical profile fields", () => {
    expect(Object.keys(USER_SELECT).sort()).toEqual(
      ["bio", "clerkId", "createdAt", "email", "id", "name", "phone", "profileImage", "timezone", "title", "updatedAt"],
    );
  });

  it("POST /api/users answers 201, and 409 User exists on a duplicate", async () => {
    prisma.user.create.mockResolvedValueOnce({ id: "u1", clerkId: "c1", name: "A", email: "a@x" });
    const ok = await request(app).post("/api/users").send({ name: "A", email: "a@x", clerkID: "c1" });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ _id: "u1", clerkID: "c1", name: "A", email: "a@x" });

    prisma.user.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    const dup = await request(app).post("/api/users").send({ name: "A", email: "a@x", clerkID: "c1" });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ message: "User exists" });
  });

  it("GET /api/users/by-clerk/:clerkId/stats is not shadowed and returns zeros for unknown users", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/api/users/by-clerk/x/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ZERO_STATS);
  });

  it("GET stats counts only future scheduled interviews", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", clerkId: "c1" });
    prisma.interview.count.mockResolvedValue(1);
    prisma.interview.findMany.mockResolvedValue([]);
    await request(app).get("/api/users/by-clerk/c1/stats");
    expect(prisma.interview.count).toHaveBeenCalledWith({
      where: { interviewerId: "u1", status: "scheduled", scheduledAt: { gte: expect.any(Date) } },
    });
    expect(prisma.interview.findMany).toHaveBeenCalledWith({
      where: { interviewerId: "u1", status: "completed" },
      select: { duration: true },
    });
  });

  it("GET /api/users/by-clerk/:clerkId answers 404 User not found", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/api/users/by-clerk/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "User not found" });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { clerkId: "nope" }, select: USER_SELECT });
  });

  it("PUT /api/users/by-clerk/:clerkId upserts and returns the profile", async () => {
    prisma.user.upsert.mockResolvedValue({ id: "u1", clerkId: "c1", name: "Ada" });
    const res = await request(app).put("/api/users/by-clerk/c1").send({ name: "Ada" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ _id: "u1", clerkID: "c1", name: "Ada" });
    expect(prisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { clerkId: "c1" }, select: USER_SELECT }));
  });

  it("PUT hides unexpected failures behind 500 Update failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.user.upsert.mockRejectedValue(new Error("db exploded"));
    const res = await request(app).put("/api/users/by-clerk/c1").send({ name: "Ada" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Update failed" });
  });
});
