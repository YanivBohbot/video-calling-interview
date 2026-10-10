import { prisma } from "../lib/db.js";
import { startQuestionGeneration, resumeQuestionGeneration } from "../lib/agents/questionGenerator/graph.js";
import {
  AIProviderError,
  AIInvalidResponseError,
  AIConfigError,
  UnknownJobError,
} from "../lib/agents/questionGenerator/errors.js";
import { createRateLimiter } from "../lib/rateLimiter.js";
import { toInterviewDoc, INTERVIEWER_SELECT } from "./controller.js";

const DEFAULT_COUNT = Number(process.env.AI_QUESTION_COUNT || 6);
const questionsLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

export const generateQuestions = async (req, res) => {
  try {
    const interview = await prisma.interview.findUnique({ where: { id: req.params.id } });
    if (!interview) return res.status(404).json({ message: "Interview not found" });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ message: "AI not configured: OPENAI_API_KEY missing" });
    }

    const key = req.user?.clerkID || req.user?.id || "anon";
    const gate = questionsLimiter.check(key);
    if (!gate.ok) {
      return res
        .status(429)
        .json({ message: "Too many AI generations, slow down", retryAfter: gate.retryAfter });
    }

    const { jobId, draftQuestions, plan } = await startQuestionGeneration({
      interviewId: interview.id,
      role: interview.role,
      interviewType: interview.interviewType,
      count: DEFAULT_COUNT,
    });

    return res.status(200).json({ jobId, status: "pending_approval", draftQuestions, plan });
  } catch (err) {
    if (err instanceof AIConfigError) {
      return res.status(500).json({ message: err.message });
    }
    if (err instanceof AIProviderError || err instanceof AIInvalidResponseError) {
      return res.status(502).json({ message: "AI service unavailable", error: err.message });
    }
    return res.status(500).json({ message: "Failed to generate questions", error: err.message });
  }
};

export const approveQuestions = async (req, res) => {
  try {
    const { jobId, approved, questions } = req.body;
    if (typeof jobId !== "string" || typeof approved !== "boolean") {
      return res.status(400).json({ message: "jobId (string) and approved (boolean) are required" });
    }
    // The thread is always addressed as `${req.params.id}:${jobId}`, so a jobId
    // minted for another interview resolves to a thread that doesn't exist and
    // surfaces as UnknownJobError (404) — it can never touch that other interview.
    const result = await resumeQuestionGeneration({
      interviewId: req.params.id,
      jobId,
      approved,
      questions,
    });

    if (!result.approved) return res.status(200).json({ status: "rejected" });

    const updated = await prisma.interview.findUnique({
      where: { id: req.params.id },
      include: { interviewer: { select: INTERVIEWER_SELECT } },
    });
    if (!updated) return res.status(404).json({ message: "Interview not found" });
    return res.status(200).json(toInterviewDoc(updated));
  } catch (err) {
    if (err instanceof UnknownJobError) {
      return res.status(404).json({ message: "No pending approval for this job" });
    }
    return res.status(500).json({ message: "Failed to resolve approval", error: err.message });
  }
};

export default { generateQuestions, approveQuestions };
