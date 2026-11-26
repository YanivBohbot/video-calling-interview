import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, PRINCIPALS } from "../helpers/testApp.js";
import { createInterviewService } from "../../services/interview.service.js";
import { INTERVIEW_LIST_SELECT, INTERVIEWER_SELECT } from "../../repositories/interview.repository.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";

// Contract details of the interview routes (shapes, Prisma calls). Who may do what is
// covered by access.test.js; here every request comes from the owner (Ada).
const OWNER = PRINCIPALS.ada;
const WITH_INTERVIEWER = { interviewer: { select: INTERVIEWER_SELECT } };
const INTERVIEWER = { id: "u-ada", name: "Ada", email: "ada@x", clerkId: "clerk_ada" };
const NESTED = { _id: "u-ada", name: "Ada", email: "ada@x", clerkID: "clerk_ada" };
const p2025 = () => Object.assign(new Error("Record not found"), { code: "P2025" });

// ── Service rules, with fakes ─────────────────────────────────────────────────

const fakeRepo = (overrides = {}) => ({
  findMany: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue({ id: "iv1", interviewerId: "u-ada" }),
  findByIdWithInterviewer: vi.fn(),
  create: vi.fn().mockResolvedValue({ id: "iv1" }),
  updateStatus: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  countDashboardStats: vi.fn(),
  findRecent: vi.fn(),
  ...overrides,
});

const service = (interviewRepository = fakeRepo()) =>
  createInterviewService({ interviewRepository, clientUrl: "http://localhost:5174" });

const VALID_BODY = {
  candidateName: "Grace",
  candidateEmail: "grace@x",
  role: "Backend",
  scheduledAt: "2026-12-01T10:00:00.000Z",
};

describe("interviewService", () => {
  it("lists the caller's interviews only", async () => {
    const repo = fakeRepo();
    await service(repo).list(OWNER);
    expect(repo.findMany).toHaveBeenCalledWith({ interviewerId: "u-ada" });
  });

  it("create requires the candidate fields", async () => {
    await expect(service().create(OWNER, { candidateName: "G" })).rejects.toEqual(
      new ValidationError("Missing required interview fields"),
    );
  });

  it("create applies the historical defaults and the caller as interviewer", async () => {
    const repo = fakeRepo();
    await service(repo).create(OWNER, VALID_BODY);
    expect(repo.create).toHaveBeenCalledWith({
      interviewerId: "u-ada",
      candidateName: "Grace",
      candidateEmail: "grace@x",
      role: "Backend",
      scheduledAt: new Date("2026-12-01T10:00:00.000Z"),
      duration: 60,
      interviewType: "technical",
      notes: "",
      company: "",
      aiInterviewerEnabled: false,
      interviewLanguage: "en",
    });
  });

  it("create forwards company, aiInterviewerEnabled and interviewLanguage", async () => {
    const repo = fakeRepo();
    await service(repo).create(OWNER, { ...VALID_BODY, company: "Acme", aiInterviewerEnabled: true, interviewLanguage: "he" });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ company: "Acme", aiInterviewerEnabled: true, interviewLanguage: "he" }),
    );
  });

  it("update forwards company, aiInterviewerEnabled and interviewLanguage", async () => {
    const repo = fakeRepo({ update: vi.fn().mockResolvedValue({ id: "iv1" }) });
    await service(repo).update(OWNER, "iv1", { company: "Acme", aiInterviewerEnabled: false, interviewLanguage: "he" });
    expect(repo.update).toHaveBeenCalledWith("iv1", { company: "Acme", aiInterviewerEnabled: false, interviewLanguage: "he" });
  });

  it("create rejects an unparseable scheduledAt with a 400", async () => {
    await expect(service().create(OWNER, { ...VALID_BODY, scheduledAt: "not a date" })).rejects.toEqual(
      new ValidationError("Invalid scheduledAt"),
    );
  });

  it("get answers 404 Interview not found when missing", async () => {
    const repo = fakeRepo({ findByIdWithInterviewer: vi.fn().mockResolvedValue(null) });
    await expect(service(repo).get(OWNER, "x")).rejects.toEqual(new NotFoundError("Interview not found"));
  });

  it("updateStatus only accepts the four known statuses", async () => {
    await expect(service().updateStatus(OWNER, "iv1", "archived")).rejects.toEqual(new ValidationError("Invalid status"));
  });

  it("update forwards only the provided fields and validates questions", async () => {
    const repo = fakeRepo({ update: vi.fn().mockResolvedValue({ id: "iv1" }) });
    await service(repo).update(OWNER, "iv1", { notes: "ok" });
    expect(repo.update).toHaveBeenCalledWith("iv1", { notes: "ok" });
    await expect(service(repo).update(OWNER, "iv1", { questions: "nope" })).rejects.toEqual(
      new ValidationError("questions must be an array"),
    );
  });

  it("dashboardStats averages the caller's completed durations", async () => {
    const repo = fakeRepo({
      countDashboardStats: vi.fn().mockResolvedValue({
        total: 4, completed: 2, live: 1, scheduled: 1, cancelled: 0, durations: [30, 90],
      }),
    });
    const stats = await service(repo).dashboardStats(OWNER);
    expect(stats).toEqual({ total: 4, completed: 2, live: 1, scheduled: 1, cancelled: 0, avgDuration: 60 });
    expect(Object.keys(stats)).toEqual(["total", "completed", "live", "scheduled", "cancelled", "avgDuration"]);
    expect(repo.countDashboardStats).toHaveBeenCalledWith("u-ada");
  });
});

// ── HTTP contract, real container over a stub prisma ─────────────────────────

let prisma;
let app;

beforeEach(() => {
  prisma = {
    interview: {
      findMany: vi.fn().mockResolvedValue([]),
      // Ownership checks read the interview first: it belongs to Ada.
      findUnique: vi.fn().mockResolvedValue({ id: "iv1", interviewerId: "u-ada", interviewer: INTERVIEWER }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  ({ app } = buildTestApp({ prisma, principal: OWNER }));
});

describe("interviews HTTP contract", () => {
  it("GET /api/interviews uses the light list select, ordered by date, scoped to the caller", async () => {
    prisma.interview.findMany.mockResolvedValue([{ id: "iv1", interviewerId: "u-ada", interviewer: INTERVIEWER }]);
    const res = await request(app).get("/api/interviews");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ _id: "iv1", interviewerId: NESTED }]);
    expect(prisma.interview.findMany).toHaveBeenCalledWith({
      where: { interviewerId: "u-ada" },
      orderBy: { scheduledAt: "asc" },
      select: INTERVIEW_LIST_SELECT,
    });
  });

  it("the list select never includes the large codeSnapshot / questions columns", () => {
    expect(INTERVIEW_LIST_SELECT).not.toHaveProperty("codeSnapshot");
    expect(INTERVIEW_LIST_SELECT).not.toHaveProperty("questions");
  });

  it("GET /stats and /activity are not shadowed by /:id", async () => {
    expect((await request(app).get("/api/interviews/stats")).body).toEqual({
      total: 0, completed: 0, live: 0, scheduled: 0, cancelled: 0, avgDuration: 0,
    });
    await request(app).get("/api/interviews/activity");
    expect(prisma.interview.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { interviewerId: "u-ada" }, orderBy: { updatedAt: "desc" }, take: 8 }),
    );
    expect(prisma.interview.findUnique).not.toHaveBeenCalled();
  });

  it("GET /:id includes the interviewer", async () => {
    const res = await request(app).get("/api/interviews/iv1");
    expect(res.body).toEqual({ _id: "iv1", interviewerId: NESTED });
    expect(prisma.interview.findUnique).toHaveBeenCalledWith({ where: { id: "iv1" }, include: WITH_INTERVIEWER });
  });

  it("GET /:id never returns the invite hash", async () => {
    prisma.interview.findUnique.mockResolvedValue({
      id: "iv1", interviewerId: "u-ada", interviewer: INTERVIEWER, inviteTokenHash: "h1",
    });
    const res = await request(app).get("/api/interviews/iv1");
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("inviteTokenHash");
  });

  it("POST creates with 201 and the nested interviewer", async () => {
    prisma.interview.create.mockResolvedValue({ id: "iv1", interviewerId: "u-ada", interviewer: INTERVIEWER });
    const res = await request(app).post("/api/interviews").send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ _id: "iv1", interviewerId: NESTED });
    expect(prisma.interview.create).toHaveBeenCalledWith(expect.objectContaining({ include: WITH_INTERVIEWER }));
  });

  it("POST rejects an unknown interviewLanguage and a non-boolean aiInterviewerEnabled", async () => {
    const lang = await request(app).post("/api/interviews").send({ ...VALID_BODY, interviewLanguage: "fr" });
    expect(lang.status).toBe(400);
    expect(lang.body).toEqual({ message: "Invalid interviewLanguage" });
    const flag = await request(app).post("/api/interviews").send({ ...VALID_BODY, aiInterviewerEnabled: "yes" });
    expect(flag.status).toBe(400);
    expect(flag.body).toEqual({ message: "Invalid aiInterviewerEnabled" });
    expect(prisma.interview.create).not.toHaveBeenCalled();
  });

  it("POST stores the three new fields over HTTP", async () => {
    prisma.interview.create.mockResolvedValue({ id: "iv1", interviewerId: "u-ada", interviewer: INTERVIEWER });
    await request(app).post("/api/interviews").send({ ...VALID_BODY, company: "Acme", aiInterviewerEnabled: true, interviewLanguage: "he" });
    expect(prisma.interview.create.mock.calls[0][0].data).toMatchObject({
      company: "Acme", aiInterviewerEnabled: true, interviewLanguage: "he",
    });
  });

  it("PATCH /:id accepts the three new fields", async () => {
    prisma.interview.update.mockResolvedValue({ id: "iv1", interviewerId: "u-ada", interviewer: INTERVIEWER });
    const res = await request(app).patch("/api/interviews/iv1").send({ company: "Acme", aiInterviewerEnabled: true, interviewLanguage: "he" });
    expect(res.status).toBe(200);
    expect(prisma.interview.update.mock.calls[0][0].data).toEqual({ company: "Acme", aiInterviewerEnabled: true, interviewLanguage: "he" });
  });

  it("PATCH /:id/status returns interviewerId as a plain string (no include)", async () => {
    prisma.interview.update.mockResolvedValue({ id: "iv1", interviewerId: "u-ada", status: "live" });
    const res = await request(app).patch("/api/interviews/iv1/status").send({ status: "live" });
    expect(res.body).toEqual({ _id: "iv1", interviewerId: "u-ada", status: "live" });
    expect(prisma.interview.update).toHaveBeenCalledWith({ where: { id: "iv1" }, data: { status: "live" } });
  });

  it("PATCH /:id returns the nested interviewer", async () => {
    prisma.interview.update.mockResolvedValue({ id: "iv1", interviewerId: "u-ada", notes: "n", interviewer: INTERVIEWER });
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
