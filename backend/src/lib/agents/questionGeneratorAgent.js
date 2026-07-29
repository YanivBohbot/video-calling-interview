import { createAgent } from "langchain";
import { z } from "zod";
import { getLeetCodeTools } from "./leetcodeMcpClient.js";
import { buildQuestionGeneratorPrompt } from "./prompts/questionGenerator.js";

export class AIConfigError extends Error {}
export class AIProviderError extends Error {}
export class AIInvalidResponseError extends Error {}

const QuestionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      category: z.enum(["technical", "behavioral", "system-design"]),
      difficulty: z.enum(["easy", "medium", "hard"]),
    }),
  ),
});

const validateQuestions = (questions) => {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new AIInvalidResponseError("Agent returned no questions");
  }
  for (const q of questions) {
    if (typeof q?.text !== "string" || !q.text.trim()) {
      throw new AIInvalidResponseError("Question missing text");
    }
  }
  return questions;
};

export const generateInterviewQuestions = async ({ role, interviewType, count }, { agent } = {}) => {
  if (!agent && !process.env.OPENAI_API_KEY) {
    throw new AIConfigError("AI not configured: OPENAI_API_KEY missing");
  }

  const runAgent =
    agent ||
    createAgent({
      model: `openai:${process.env.AI_MODEL || "gpt-4o-mini"}`,
      tools: await getLeetCodeTools(),
      systemPrompt: buildQuestionGeneratorPrompt(),
      responseFormat: QuestionsSchema,
    });

  let result;
  try {
    result = await runAgent.invoke(
      {
        messages: [
          {
            role: "user",
            content: `Generate exactly ${count} interview questions.\nRole: ${role}\nInterview type: ${interviewType}`,
          },
        ],
      },
      { recursionLimit: 10 },
    );
  } catch (err) {
    throw new AIProviderError(`Agent invocation failed: ${err.message}`);
  }

  return validateQuestions(result?.structuredResponse?.questions);
};
