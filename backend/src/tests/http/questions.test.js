import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, TEST_CONFIG, authAs, PRINCIPALS } from "../helpers/testApp.js";

const { ada, bob, demo, candidateOf } = PRINCIPALS;
import {
  AIConfigError,
  AIProviderError,
  UnknownJobError,
} from "../../agents/questionGenerator/index.js";

// Ported from the pre-refactor aiController tests (same 12 cases), now driven over HTTP
// through the real container, with fakes injected for the AI pipeline and identity — no vi.mock.

let interviewRepository;
let generation;
let config;
let app;

// The real interview repository reads through prisma.interview.findUnique; this stub routes
// the two query shapes it uses to two spies, so each case can say which lookup happened.
const stubPrisma = () => ({
  interview: {
    findUnique: (args) =>
      args.include ? interviewRepository.findByIdWithInterviewer(args.where.id) : interviewRepository.findById(args.where.id),
  },
});

const build = () => {
  ({ app } = buildTestApp({ prisma: stubPrisma(), config, generation, principal: ada }));
};

const generate = (id = "iv-1", principal = ada) =>
  request(app).post(`/api/interviews/${id}/questions/generate`).set(authAs(principal));
const approve = (body, id = "iv-1", principal = ada) =>
  request(app).post(`/api/interviews/${id}/questions/approve`).set(authAs(principal)).send(body);

beforeEach(() => {
  // By default every interview belongs to Ada (the caller).
  interviewRepository = {
    findById: vi.fn(async (id) => ({ id, interviewerId: "u-ada", role: "x", interviewType: "technical" })),
    findByIdWithInterviewer: vi.fn(),
  };
  generation = { start: vi.fn(), resume: vi.fn() };
  config = TEST_CONFIG;
  build();
});

describe("POST /api/interviews/:id/questions/generate", () => {
  it("returns 404 when interview not found", async () => {
    interviewRepository.findById.mockResolvedValue(null);
    const res = await generate();
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Interview not found" });
  });

  it("returns 500 when OPENAI_API_KEY is missing", async () => {
    config = { ...TEST_CONFIG, openaiApiKey: undefined };
    build();
    interviewRepository.findById.mockResolvedValue({ id: "iv-1", interviewerId: "u-ada", role: "x", interviewType: "technical" });
    const res = await generate("iv-1");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "AI not configured: OPENAI_API_KEY missing" });
    expect(generation.start).not.toHaveBeenCalled();
  });

  it("does not require an OpenAI key when another provider's model is configured", async () => {
    config = { ...TEST_CONFIG, openaiApiKey: undefined, aiModel: "anthropic:claude-sonnet-5" };
    build();
    generation.start.mockResolvedValue({ jobId: "j", draftQuestions: [], plan: {} });
    expect((await generate()).status).toBe(200);
  });

  it("returns 429 after exhausting the rate limit for a key", async () => {
    interviewRepository.findById.mockResolvedValue({ id: "iv-1", interviewerId: "u-ada", role: "x", interviewType: "technical" });
    generation.start.mockResolvedValue({ jobId: "job-1", draftQuestions: [], plan: {} });
    for (let i = 0; i < 10; i++) await generate();
    const res = await generate();
    expect(res.status).toBe(429);
    expect(res.body.message).toBe("Too many AI generations, slow down");
    expect(typeof res.body.retryAfter).toBe("number");
  });

  it("returns 502 when the generation throws AIProviderError, without the provider detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    interviewRepository.findById.mockResolvedValue({ id: "iv-2", interviewerId: "u-ada", role: "x", interviewType: "technical" });
    generation.start.mockRejectedValue(new AIProviderError("boom: upstream 503 at api.openai.com"));
    const res = await generate("iv-2");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: "AI service unavailable" });
  });

  it("answers an AIConfigError with a fixed 500 message, never the internal detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    interviewRepository.findById.mockResolvedValue({ id: "iv-1", interviewerId: "u-ada", role: "x", interviewType: "technical" });
    generation.start.mockRejectedValue(new AIConfigError("AI_MODEL is not a supported model"));
    const res = await generate("iv-1");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "AI is not configured correctly" });
  });

  it("returns 200 with jobId/draftQuestions/plan on success", async () => {
    const draftQuestions = [{ text: "Q1", category: "technical", difficulty: "easy" }];
    const plan = { categoryCounts: { technical: 1 } };
    interviewRepository.findById.mockResolvedValue({ id: "iv-3", interviewerId: "u-ada", role: "Backend", interviewType: "technical" });
    generation.start.mockResolvedValue({ jobId: "job-3", draftQuestions, plan });
    const res = await generate("iv-3");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobId: "job-3", status: "pending_approval", draftQuestions, plan });
    expect(generation.start).toHaveBeenCalledWith({
      interviewId: "iv-3",
      role: "Backend",
      interviewType: "technical",
      count: 6,
    });
  });

  it("caps demo generations at 5 per hour in total", async () => {
    interviewRepository.findById.mockResolvedValue({ id: "iv-d", interviewerId: "u-demo", role: "x", interviewType: "technical" });
    generation.start.mockResolvedValue({ jobId: "j", draftQuestions: [], plan: {} });
    for (let i = 0; i < 5; i++) expect((await generate("iv-d", demo)).status).toBe(200);
    const res = await generate("iv-d", demo);
    expect(res.status).toBe(429);
  });

  it("answers 404 on someone else's interview, without calling the AI", async () => {
    const res = await generate("iv-1", bob);
    expect(res.status).toBe(404);
    expect((await approve({ jobId: "j", approved: true }, "iv-1", bob)).status).toBe(404);
    expect(generation.start).not.toHaveBeenCalled();
    expect(generation.resume).not.toHaveBeenCalled();
  });

  it("is closed to candidates", async () => {
    expect((await generate("iv-1", candidateOf("iv-1"))).status).toBe(403);
  });

  it("refuses callers without an identity", async () => {
    const res = await request(app).post("/api/interviews/iv-1/questions/generate").set(authAs(null));
    expect(res.status).toBe(401);
    expect(interviewRepository.findById).not.toHaveBeenCalled();
  });

  it("hides unexpected failures behind Failed to generate questions", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    interviewRepository.findById.mockRejectedValue(new Error("db down"));
    const res = await generate("iv-1");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Failed to generate questions" });
  });
});

describe("POST /api/interviews/:id/questions/approve", () => {
  it("returns 400 when jobId or approved is missing/wrong type", async () => {
    const res = await approve({ approved: true });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "jobId (string) and approved (boolean) are required" });
  });

  it.each([
    ["an empty-text row", [{ text: "", category: "technical", difficulty: "easy" }]],
    ["a bogus category", [{ text: "Q", category: "nope", difficulty: "easy" }]],
    ["a non-array", "not-an-array"],
    ["null", null],
  ])("returns 400 for %s and leaves the draft pending (never resumes)", async (_label, questions) => {
    const res = await approve({ jobId: "j", approved: true, questions });
    expect(res.status).toBe(400);
    expect(generation.resume).not.toHaveBeenCalled();
  });

  it("does not validate questions on reject (they are ignored)", async () => {
    generation.resume.mockResolvedValue({ approved: false });
    const res = await approve({ jobId: "j", approved: false, questions: "junk" });
    expect(res.status).toBe(200);
    expect(generation.resume).toHaveBeenCalledWith(expect.objectContaining({ questions: undefined }));
  });

  it("scopes the resume to the interview in the URL, never one named in the body", async () => {
    generation.resume.mockResolvedValue({ approved: false });
    await approve({ jobId: "job-from-iv-2", approved: true, interviewId: "iv-2" }, "iv-1");
    expect(generation.resume).toHaveBeenCalledWith(
      expect.objectContaining({ interviewId: "iv-1", jobId: "job-from-iv-2" }),
    );
  });

  it("returns 404 when the job has no pending approval (unknown or already resolved)", async () => {
    generation.resume.mockRejectedValue(new UnknownJobError("no pending approval"));
    const res = await approve({ jobId: "iv-1:stale", approved: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "No pending approval for this job" });
    expect(interviewRepository.findByIdWithInterviewer).not.toHaveBeenCalled();
  });

  it.each([
    ["an AIProviderError", () => new AIProviderError("resume blew up")],
    ["an AIConfigError", () => new AIConfigError("bad model")],
  ])("keeps the historical 500 Failed to resolve approval for %s during resume", async (_label, makeErr) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generation.resume.mockRejectedValue(makeErr());
    const res = await approve({ jobId: "iv-1:abc", approved: true });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Failed to resolve approval" });
  });

  it("returns { status: 'rejected' } and does not look up the interview on reject", async () => {
    generation.resume.mockResolvedValue({ approved: false });
    const res = await approve({ jobId: "iv-1:abc", approved: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "rejected" });
    expect(interviewRepository.findByIdWithInterviewer).not.toHaveBeenCalled();
  });

  it("returns the updated interview doc on approve", async () => {
    generation.resume.mockResolvedValue({ approved: true });
    interviewRepository.findByIdWithInterviewer.mockResolvedValue({
      id: "iv-1",
      interviewerId: "u1",
      questions: [],
      interviewer: { id: "u1", name: "A", email: "a@x", clerkId: "c1" },
    });
    const res = await approve({ jobId: "iv-1:abc", approved: true, questions: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      _id: "iv-1",
      questions: [],
      interviewerId: { _id: "u1", name: "A", email: "a@x", clerkID: "c1" },
    });
  });
});
