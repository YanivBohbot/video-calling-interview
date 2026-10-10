import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/db.js", () => ({
  prisma: {
    interview: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../lib/agents/questionGenerator/graph.js", () => ({
  startQuestionGeneration: vi.fn(),
  resumeQuestionGeneration: vi.fn(),
}));

vi.mock("../lib/agents/questionGenerator/errors.js", () => ({
  AIProviderError: class AIProviderError extends Error {},
  AIInvalidResponseError: class AIInvalidResponseError extends Error {},
  AIConfigError: class AIConfigError extends Error {},
  UnknownJobError: class UnknownJobError extends Error {},
}));

import { prisma } from "../lib/db.js";
import { startQuestionGeneration, resumeQuestionGeneration } from "../lib/agents/questionGenerator/graph.js";
import { AIProviderError, UnknownJobError } from "../lib/agents/questionGenerator/errors.js";
import { generateQuestions, approveQuestions } from "./aiController.js";

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseReq = {
  params: { id: "iv-1" },
  user: { clerkID: "user-a", id: "user-a-internal" },
  body: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "sk-test";
});

describe("generateQuestions controller", () => {
  it("returns 404 when interview not found", async () => {
    prisma.interview.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await generateQuestions(baseReq, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 500 when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-1", role: "x", interviewType: "technical" });
    const res = mockRes();
    await generateQuestions({ ...baseReq, user: { clerkID: "user-nokey" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(startQuestionGeneration).not.toHaveBeenCalled();
  });

  it("returns 429 after exhausting the rate limit for a key", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-1", role: "x", interviewType: "technical" });
    startQuestionGeneration.mockResolvedValue({ jobId: "job-1", draftQuestions: [], plan: {} });

    for (let i = 0; i < 10; i++) {
      await generateQuestions(baseReq, mockRes());
    }
    const res = mockRes();
    await generateQuestions(baseReq, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: expect.any(Number) }));
  });

  it("returns 502 when startQuestionGeneration throws AIProviderError", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-2", role: "x", interviewType: "technical" });
    startQuestionGeneration.mockRejectedValue(new AIProviderError("boom"));
    const res = mockRes();
    await generateQuestions({ ...baseReq, params: { id: "iv-2" }, user: { clerkID: "user-b" } }, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("returns 200 with jobId/draftQuestions/plan on success", async () => {
    const draftQuestions = [{ text: "Q1", category: "technical", difficulty: "easy" }];
    const plan = { categoryCounts: { technical: 1 } };
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-3", role: "Backend", interviewType: "technical" });
    startQuestionGeneration.mockResolvedValue({ jobId: "job-3", draftQuestions, plan });
    const res = mockRes();
    await generateQuestions({ ...baseReq, params: { id: "iv-3" }, user: { clerkID: "user-c" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ jobId: "job-3", status: "pending_approval", draftQuestions, plan });
    expect(startQuestionGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ role: "Backend", interviewType: "technical" }),
    );
  });
});

describe("approveQuestions controller", () => {
  it("returns 400 when jobId or approved is missing/wrong type", async () => {
    const res = mockRes();
    await approveQuestions({ ...baseReq, body: { approved: true } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("scopes the resume to the interview in the URL, never one named in the body", async () => {
    resumeQuestionGeneration.mockResolvedValue({ approved: false });
    const res = mockRes();
    await approveQuestions(
      { ...baseReq, params: { id: "iv-1" }, body: { jobId: "job-from-iv-2", approved: true, interviewId: "iv-2" } },
      res,
    );
    expect(resumeQuestionGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ interviewId: "iv-1", jobId: "job-from-iv-2" }),
    );
  });

  it("returns 404 when the job has no pending approval (unknown or already resolved)", async () => {
    resumeQuestionGeneration.mockRejectedValue(new UnknownJobError("no pending approval"));
    const res = mockRes();
    await approveQuestions({ ...baseReq, params: { id: "iv-1" }, body: { jobId: "iv-1:stale", approved: true } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.interview.findUnique).not.toHaveBeenCalled();
  });

  it("returns { status: 'rejected' } and does not look up the interview on reject", async () => {
    resumeQuestionGeneration.mockResolvedValue({ approved: false });
    const res = mockRes();
    await approveQuestions({ ...baseReq, params: { id: "iv-1" }, body: { jobId: "iv-1:abc", approved: false } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: "rejected" });
    expect(prisma.interview.findUnique).not.toHaveBeenCalled();
  });

  it("returns the updated interview doc on approve", async () => {
    resumeQuestionGeneration.mockResolvedValue({ approved: true });
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-1", role: "x", interviewType: "technical", questions: [] });
    const res = mockRes();
    await approveQuestions({ ...baseReq, params: { id: "iv-1" }, body: { jobId: "iv-1:abc", approved: true, questions: [] } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ _id: "iv-1" }));
  });
});
