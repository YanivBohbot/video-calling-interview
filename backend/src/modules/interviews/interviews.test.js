import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createInterviewsModule } from "./index.js";
import { createInterviewService } from "./interview.service.js";
import { INTERVIEW_LIST_SELECT, INTERVIEWER_SELECT } from "./interview.repository.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";

const WITH_INTERVIEWER = { interviewer: { select: INTERVIEWER_SELECT } };
const INTERVIEWER = { id: "u1", name: "Ada", email: "ada@x", clerkId: "c1" };
const NESTED = { _id: "u1", name: "Ada", email: "ada@x", clerkID: "c1" };
const p2025 = () => Object.assign(new Error("Record not found"), { code: "P2025" });

// ── Service rules, with fakes ─────────────────────────────────────────────────

const fakeRepo = (overrides = {}) => ({
  findMany: vi.fn().mockResolvedValue([]),
  findByIdWithInterviewer: vi.fn(),
  create: vi.fn().mockResolvedValue({ id: "iv1" }),
  updateStatus: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  countDashboardStats: vi.fn(),
  findRecent: vi.fn(),
  ...overrides,
});

const VALID_BODY = {
  candidateName: "Grace",
  candidateEmail: "grace@x",
  role: "Backend",
  scheduledAt: "2026-12-01T10:00:00.000Z",
};

describe("interviewService", () => {
  it("list rejects an unknown interviewer with 400 Interviewer not found", async () => {
    const service = createInterviewService({ interviewRepository: fakeRepo(), resolveInterviewerId: async () => null });
    await expect(service.list({ rawInterviewer: "ghost" })).rejects.toEqual(new ValidationError("Interviewer not found"));
  });

  it("list without an interviewer filter queries everything", async () => {
    const interviewRepository = fakeRepo();
    await createInterviewService({ interviewRepository, resolveInterviewerId: vi.fn() }).list({});
    expect(interviewRepository.findMany).toHaveBeenCalledWith({});
  });

  it("create requires the interviewer and candidate fields", async () => {
    const service = createInterviewService({ interviewRepository: fakeRepo(), resolveInterviewerId: vi.fn() });
    await expect(service.create({ rawInterviewer: "c1", body: { candidateName: "G" } })).rejects.toEqual(
      new ValidationError("Missing required interview fields"),
    );
    await expect(service.create({ body: VALID_BODY })).rejects.toEqual(
      new ValidationError("Missing required interview fields"),
    );
  });

  it("create applies the historical defaults", async () => {
    const interviewRepository = fakeRepo();
    const service = createInterviewService({ interviewRepository, resolveInterviewerId: async () => "u1" });
    await service.create({ rawInterviewer: "c1", body: VALID_BODY });
    expect(interviewRepository.create).toHaveBeenCalledWith({
      interviewerId: "u1",
      candidateName: "Grace",
      candidateEmail: "grace@x",
      role: "Backend",
      scheduledAt: new Date("2026-12-01T10:00:00.000Z"),
      duration: 60,
      interviewType: "technical",
      notes: "",
    });
  });

  it("create rejects an unparseable scheduledAt with a 400", async () => {
    const service = createInterviewService({ interviewRepository: fakeRepo(), resolveInterviewerId: async () => "u1" });
    await expect(service.create({ rawInterviewer: "c1", body: { ...VALID_BODY, scheduledAt: "not a date" } }))
      .rejects.toEqual(new ValidationError("Invalid scheduledAt"));
  });

  it("get answers 404 Interview not found", async () => {
    const interviewRepository = fakeRepo({ findByIdWithInterviewer: vi.fn().mockResolvedValue(null) });
    const service = createInterviewService({ interviewRepository, resolveInterviewerId: vi.fn() });
    await expect(service.get("x")).rejects.toEqual(new NotFoundError("Interview not found"));
  });

  it("updateStatus only accepts the four known statuses", async () => {
    const service = createInterviewService({ interviewRepository: fakeRepo(), resolveInterviewerId: vi.fn() });
    await expect(service.updateStatus("iv1", "archived")).rejects.toEqual(new ValidationError("Invalid status"));
  });

  it("update forwards only the provided fields and validates questions", async () => {
    const interviewRepository = fakeRepo({ update: vi.fn().mockResolvedValue({ id: "iv1" }) });
    const service = createInterviewService({ interviewRepository, resolveInterviewerId: vi.fn() });
    await service.update("iv1", { notes: "ok" });
    expect(interviewRepository.update).toHaveBeenCalledWith("iv1", { notes: "ok" });
    await expect(service.update("iv1", { questions: "nope" })).rejects.toEqual(
      new ValidationError("questions must be an array"),
    );
  });

  it("dashboardStats averages completed durations", async () => {
    const interviewRepository = fakeRepo({
      countDashboardStats: vi.fn().mockResolvedValue({
        total: 4, completed: 2, live: 1, scheduled: 1, cancelled: 0, totalUsers: 3, durations: [30, 90],
      }),
    });
    const stats = await createInterviewService({ interviewRepository, resolveInterviewerId: vi.fn() }).dashboardStats();
    expect(stats).toEqual({ total: 4, completed: 2, live: 1, scheduled: 1, cancelled: 0, avgDuration: 60, totalUsers: 3 });
    expect(Object.keys(stats)).toEqual(["total", "completed", "live", "scheduled", "cancelled", "avgDuration", "totalUsers"]);
  });
});

// ── HTTP contract, real module over a stub prisma ────────────────────────────

let prisma;
let app;
let resolveInterviewerId;

beforeEach(() => {
  prisma = {
    interview: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    user: { count: vi.fn().mockResolvedValue(0) },
  };
  resolveInterviewerId = vi.fn(async (raw) => (raw === "ghost" ? null : `id-of-${raw}`));
  const interviews = createInterviewsModule({ prisma, resolveInterviewerId });
  app = createApp({ config: { clientUrl: "http://x" }, routers: { interviews: interviews.router } });
});

describe("interviews HTTP contract", () => {
  it("GET /api/interviews uses the light list select, ordered by date", async () => {
    prisma.interview.findMany.mockResolvedValue([{ id: "iv1", interviewerId: "u1", interviewer: INTERVIEWER }]);
    const res = await request(app).get("/api/interviews");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ _id: "iv1", interviewerId: NESTED }]);
    expect(prisma.interview.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { scheduledAt: "asc" },
      select: INTERVIEW_LIST_SELECT,
    });
  });

  it("the list select never includes the large codeSnapshot / questions columns", () => {
    expect(INTERVIEW_LIST_SELECT).not.toHaveProperty("codeSnapshot");
    expect(INTERVIEW_LIST_SELECT).not.toHaveProperty("questions");
    expect(Object.keys(INTERVIEW_LIST_SELECT).sort()).toEqual([
      "candidateEmail", "candidateName", "codeLanguage", "createdAt", "duration", "id", "interviewType",
      "interviewer", "interviewerId", "notes", "role", "scheduledAt", "status", "updatedAt",
    ]);
  });

  it("the x-clerk-id header wins over ?interviewerId", async () => {
    await request(app).get("/api/interviews?interviewerId=b").set("x-clerk-id", "a");
    expect(resolveInterviewerId).toHaveBeenCalledWith("a");
    expect(prisma.interview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { interviewerId: "id-of-a" } }));
  });

  it("GET with an unknown interviewer answers 400", async () => {
    const res = await request(app).get("/api/interviews?interviewerId=ghost");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Interviewer not found" });
  });

  it("GET /stats is not shadowed by /:id", async () => {
    const res = await request(app).get("/api/interviews/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 0, completed: 0, live: 0, scheduled: 0, cancelled: 0, avgDuration: 0, totalUsers: 0 });
    expect(prisma.interview.findUnique).not.toHaveBeenCalled();
  });

  it("GET /activity maps the 8 latest updates", async () => {
    prisma.interview.findMany.mockResolvedValue([
      { id: "iv1", candidateName: "G", role: "R", status: "live", scheduledAt: "s", updatedAt: "u", interviewType: "technical", interviewer: null },
    ]);
    const res = await request(app).get("/api/interviews/activity");
    expect(res.body).toEqual([
      { id: "iv1", candidateName: "G", role: "R", status: "live", interviewType: "technical", interviewerName: "Unknown", scheduledAt: "s", updatedAt: "u" },
    ]);
    expect(prisma.interview.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { updatedAt: "desc" }, take: 8 }));
    expect(prisma.interview.findUnique).not.toHaveBeenCalled();
  });

  it("GET /:id includes the interviewer", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv1", interviewerId: "u1", interviewer: INTERVIEWER });
    const res = await request(app).get("/api/interviews/iv1");
    expect(res.body).toEqual({ _id: "iv1", interviewerId: NESTED });
    expect(prisma.interview.findUnique).toHaveBeenCalledWith({ where: { id: "iv1" }, include: WITH_INTERVIEWER });
  });

  it("POST creates with 201 and the nested interviewer", async () => {
    prisma.interview.create.mockResolvedValue({ id: "iv1", interviewerId: "u1", interviewer: INTERVIEWER });
    const res = await request(app).post("/api/interviews").send({ ...VALID_BODY, interviewerId: "c1" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ _id: "iv1", interviewerId: NESTED });
    expect(prisma.interview.create).toHaveBeenCalledWith(expect.objectContaining({ include: WITH_INTERVIEWER }));
    expect(resolveInterviewerId).toHaveBeenCalledWith("c1");
  });

  it("POST with an unknown interviewer answers 400 Interviewer not found", async () => {
    const res = await request(app).post("/api/interviews").send({ ...VALID_BODY, interviewerClerkId: "ghost" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Interviewer not found" });
  });

  it("PATCH /:id/status returns interviewerId as a plain string (no include)", async () => {
    prisma.interview.update.mockResolvedValue({ id: "iv1", interviewerId: "u1", status: "live" });
    const res = await request(app).patch("/api/interviews/iv1/status").send({ status: "live" });
    expect(res.body).toEqual({ _id: "iv1", interviewerId: "u1", status: "live" });
    expect(prisma.interview.update).toHaveBeenCalledWith({ where: { id: "iv1" }, data: { status: "live" } });
  });

  it("PATCH /:id returns the nested interviewer", async () => {
    prisma.interview.update.mockResolvedValue({ id: "iv1", interviewerId: "u1", notes: "n", interviewer: INTERVIEWER });
    const res = await request(app).patch("/api/interviews/iv1").send({ notes: "n" });
    expect(res.body).toEqual({ _id: "iv1", notes: "n", interviewerId: NESTED });
    expect(prisma.interview.update).toHaveBeenCalledWith({ where: { id: "iv1" }, data: { notes: "n" }, include: WITH_INTERVIEWER });
  });

  it("PATCH /:id with a bogus status answers 400 Invalid status", async () => {
    const res = await request(app).patch("/api/interviews/iv1").send({ status: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid status" });
  });

  it("DELETE answers 200, and 404 when the record is gone", async () => {
    prisma.interview.delete.mockResolvedValueOnce({});
    const ok = await request(app).delete("/api/interviews/iv1");
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ message: "Interview deleted" });

    prisma.interview.delete.mockRejectedValueOnce(p2025());
    const gone = await request(app).delete("/api/interviews/iv1");
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual({ message: "Interview not found" });
  });

  it("hides database failures behind the historical message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.interview.findMany.mockRejectedValue(new Error("connection refused 127.0.0.1"));
    const res = await request(app).get("/api/interviews");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Error fetching interviews" });
  });
});
