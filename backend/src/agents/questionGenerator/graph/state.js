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

// What the drafter model returns: it only names a slug, and code builds the source.
// sourceSlug is nullable rather than optional because OpenAI strict mode requires
// every property to be present.
export const DraftQuestionSchema = z.object({
  text: z.string(),
  category: z.enum(["technical", "behavioral", "system-design"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  sourceSlug: z.string().nullable(),
});

export const DraftResponseSchema = z.object({
  questions: z.array(DraftQuestionSchema),
});

// Subsets of the LeetCode MCP search_problems enums, so whatever the model picks is
// an input the tool accepts.
export const SEARCH_CATEGORIES = ["algorithms", "database", "pandas", "javascript", "shell", "concurrency"];
export const SEARCH_TAGS = [
  "array", "string", "hash-table", "dynamic-programming", "math", "sorting", "greedy",
  "depth-first-search", "breadth-first-search", "binary-search", "database", "tree", "binary-tree",
  "matrix", "two-pointers", "heap-priority-queue", "prefix-sum", "stack", "queue", "graph",
  "sliding-window", "design", "backtracking", "linked-list", "union-find", "trie", "recursion",
  "binary-search-tree", "bit-manipulation", "simulation",
];

// What the model returns for research: only the search filters. Code runs the search,
// so the model can't loop, skip the offset, or cite a problem the search didn't return.
export const SearchQuerySchema = z.object({
  category: z.enum(SEARCH_CATEGORIES),
  tags: z.array(z.enum(SEARCH_TAGS)),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
});

// Runtime context (LangGraph `contextSchema`): the run's dependencies. Passed as
// `{ context }` on every invoke by execution/generator.js, read by nodes as `runtime.context`,
// and never written to a checkpoint.
const fn = () => z.custom((v) => typeof v === "function", { message: "must be a function" });
export const QuestionGenContext = z.object({
  chooseSearch: fn(), // ({ role, interviewType }) → LeetCode search filters  (models.js)
  searchProblems: fn(), // (filters) → [{ slug, title, difficulty }]          (tools/leetcode/search.js)
  draft: fn(), // ({ useFallbackModel, prompt }) → { questions }                 (models.js)
  saveQuestions: fn(), // (interviewId, questions) → void          (interview repository)
  random: fn().optional(), // () → [0, 1); defaults to Math.random (tests pin it)
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
