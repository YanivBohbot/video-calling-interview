import { prisma } from "../lib/db.js";
import {
  generateInterviewQuestions,
  AIProviderError,
  AIInvalidResponseError,
  AIConfigError,
} from "../lib/agents/questionGeneratorAgent.js";
import { createRateLimiter } from "../lib/rateLimiter.js";

const DEFAULT_COUNT = Number(process.env.AI_QUESTION_COUNT || 6);
const questionsLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

export const generateQuestions = async (req, res) => {
  try {
    const interview = await prisma.interview.findUnique({ where: { id: req.params.id } });
    if (!interview) return res.status(404).json({ message: "Interview not found" });

    const key = req.user?.clerkID || req.user?.id || "anon";
    const gate = questionsLimiter.check(key);
    if (!gate.ok) {
      return res
        .status(429)
        .json({ message: "Too many AI generations, slow down", retryAfter: gate.retryAfter });
    }

    const questions = await generateInterviewQuestions({
      role: interview.role,
      interviewType: interview.interviewType,
      count: DEFAULT_COUNT,
    });

    return res.status(200).json({ questions });
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

export default { generateQuestions };
