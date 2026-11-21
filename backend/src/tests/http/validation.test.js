import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp } from "../helpers/testApp.js";

// Request validation at the route boundary (Zod). Two promises:
//  - what the frontend sends today is still accepted;
//  - malformed input is a 400 with a clear message, and never reaches Prisma.

let prisma;
let app;
let streamClient;

beforeEach(() => {
  prisma = {
    interview: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: "iv1", interviewerId: "u-demo" }) },
    user: {
      create: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: "demo-id", clerkId: "demo", name: "Demo User" }),
      findUnique: vi.fn().mockResolvedValue({ id: "u1" }),
    },
  };
  streamClient = { generateUserToken: vi.fn().mockReturnValue("t") };
  ({ app } = buildTestApp({ prisma, getStreamClient: () => streamClient }));
});

const FRONTEND_NEW_INTERVIEW = {
  candidateName: "Grace",
  candidateEmail: "grace@x.dev",
  role: "Senior Backend Engineer",
  scheduledAt: "2026-12-01T10:00:00.000Z",
  duration: 60,
  interviewType: "technical",
  notes: "",
};

describe("POST /api/interviews", () => {
  it("accepts the payload the New Interview page sends", async () => {
    prisma.interview.create.mockResolvedValue({ id: "iv1", interviewerId: "demo-id" });
    const res = await request(app).post("/api/interviews").send(FRONTEND_NEW_INTERVIEW);
    expect(res.status).toBe(201);
  });

  it.each([
    ["a non-string candidate name", { candidateName: 42 }, "Missing required interview fields"],
    ["a missing role", { role: undefined }, "Missing required interview fields"],
    ["a non-numeric duration", { duration: "abc" }, "Invalid duration"],
    ["a negative duration", { duration: -5 }, "Invalid duration"],
    ["non-string notes", { notes: { a: 1 } }, "Invalid notes"],
    ["a non-string interview type", { interviewType: 7 }, "Invalid interviewType"],
  ])("rejects %s with a 400 before touching the database", async (_label, patch, message) => {
    const res = await request(app).post("/api/interviews").send({ ...FRONTEND_NEW_INTERVIEW, ...patch });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message });
    expect(prisma.interview.create).not.toHaveBeenCalled();
  });

  it("still lets a null duration fall back to the 60-minute default", async () => {
    prisma.interview.create.mockResolvedValue({ id: "iv1", interviewerId: "demo-id" });
    await request(app).post("/api/interviews").send({ ...FRONTEND_NEW_INTERVIEW, duration: null });
    expect(prisma.interview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ duration: 60 }) }));
  });
});

describe("PATCH /api/interviews/:id and /:id/status", () => {
  it("accepts the report the interview room sends", async () => {
    prisma.interview.update.mockResolvedValue({ id: "iv1", interviewerId: "u1" });
    const res = await request(app).patch("/api/interviews/iv1").send({ notes: "Strong candidate", status: "completed" });
    expect(res.status).toBe(200);
  });

  it("rejects non-string notes", async () => {
    const res = await request(app).patch("/api/interviews/iv1").send({ notes: ["x"] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid notes" });
    expect(prisma.interview.update).not.toHaveBeenCalled();
  });

  it("rejects a status that is not one of the four", async () => {
    const res = await request(app).patch("/api/interviews/iv1/status").send({ status: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid status" });
  });
});

describe("users", () => {
  it("accepts the Profile page's save, including null fields", async () => {
    prisma.user.upsert.mockResolvedValue({ id: "u1", clerkId: "c1", name: "Ada" });
    const res = await request(app)
      .put("/api/users/me")
      .send({ name: "Ada", title: null, bio: "", phone: null, timezone: "UTC", email: null });
    expect(res.status).toBe(200);
  });

  it("rejects a non-string name on profile save", async () => {
    const res = await request(app).put("/api/users/me").send({ name: 42 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Name is required" });
  });

  it("rejects a non-string profile field", async () => {
    const res = await request(app).put("/api/users/me").send({ name: "Ada", bio: { html: "<b>" } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid bio" });
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

});

describe("questions and stream", () => {
  it("rejects an approval whose approved flag is not a boolean", async () => {
    const res = await request(app)
      .post("/api/interviews/iv1/questions/approve")
      .send({ jobId: "j", approved: "yes" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "jobId (string) and approved (boolean) are required" });
  });

});
