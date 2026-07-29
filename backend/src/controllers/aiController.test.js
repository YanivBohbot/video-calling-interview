import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/db.js", () => ({
  prisma: {
    interview: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../lib/agents/questionGeneratorAgent.js", () => ({
  generateInterviewQuestions: vi.fn(),
  AIProviderError: class AIProviderError extends Error {},
  AIInvalidResponseError: class AIInvalidResponseError extends Error {},
  AIConfigError: class AIConfigError extends Error {},
}));

import { prisma } from "../lib/db.js";
import {
  generateInterviewQuestions,
  AIProviderError,
} from "../lib/agents/questionGeneratorAgent.js";
import { generateQuestions } from "./aiController.js";

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseReq = {
  params: { id: "iv-1" },
  user: { clerkID: "user-a", id: "user-a-internal" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateQuestions controller", () => {
  it("returns 404 when interview not found", async () => {
    prisma.interview.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await generateQuestions(baseReq, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 429 after exhausting the rate limit for a key", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-1", role: "x", interviewType: "technical" });
    generateInterviewQuestions.mockResolvedValue([{ text: "Q", category: "technical", difficulty: "easy" }]);

    // Exhaust the limiter for this key (max 10/hour) — 11th call must 429.
    for (let i = 0; i < 10; i++) {
      const res = mockRes();
      await generateQuestions(baseReq, res);
    }
    const res = mockRes();
    await generateQuestions(baseReq, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: expect.any(Number) }));
  });

  it("returns 502 when the agent throws AIProviderError", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-2", role: "x", interviewType: "technical" });
    generateInterviewQuestions.mockRejectedValue(new AIProviderError("boom"));
    const res = mockRes();
    await generateQuestions({ ...baseReq, params: { id: "iv-2" }, user: { clerkID: "user-b" } }, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("returns 200 with the questions array on success", async () => {
    const questions = [{ text: "Q1", category: "technical", difficulty: "easy" }];
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-3", role: "Backend", interviewType: "technical" });
    generateInterviewQuestions.mockResolvedValue(questions);
    const res = mockRes();
    await generateQuestions({ ...baseReq, params: { id: "iv-3" }, user: { clerkID: "user-c" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ questions });
    expect(generateInterviewQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ role: "Backend", interviewType: "technical" }),
    );
  });
});
