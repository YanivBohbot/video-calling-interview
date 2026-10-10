import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const SourceSchema = z.object({
  type: z.literal("leetcode"),
  title: z.string(),
  slug: z.string(),
  difficulty: z.string(),
  url: z.string(),
});

export const QuestionSchema = z.object({
  text: z.string(),
  category: z.enum(["technical", "behavioral", "system-design"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  source: SourceSchema.optional(),
});

export const ResearchProblemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  difficulty: z.string(),
});

export const DraftResponseSchema = z.object({
  questions: z.array(QuestionSchema),
});

// The model names slugs only; facts come from the tool results (see sources.js).
export const ResearchResponseSchema = z.object({
  problems: z.array(z.object({ slug: z.string() })),
});

export const QuestionGenState = new StateSchema({
  interviewId: z.string(),
  role: z.string(),
  interviewType: z.string(),
  count: z.number(),
  plan: z.object({ categoryCounts: z.record(z.number()) }).nullable().default(null),
  research: z.array(ResearchProblemSchema).default(() => []),
  draftQuestions: z.array(QuestionSchema).default(() => []),
  validationErrors: z.array(z.string()).default(() => []),
  retryCount: z.number().default(0),
  useFallbackModel: z.boolean().default(false),
  approval: z
    .object({ approved: z.boolean(), questions: z.array(QuestionSchema).optional() })
    .nullable()
    .default(null),
});
