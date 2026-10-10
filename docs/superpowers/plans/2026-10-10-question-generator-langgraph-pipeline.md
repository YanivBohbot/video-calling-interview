# Question-Generator LangGraph Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `createAgent` call in the interview question generator with an explicit 7-node LangGraph pipeline that separately, testably implements planning, tool selection, delegation, retries, fallback, error recovery, and a real (checkpointed) human-in-the-loop approval pause.

**Architecture:** A `StateGraph` (`planner → researcher → drafter → validator ⇄ drafter/fallback → humanApproval → finalize`) compiled with a swappable checkpointer. `POST /questions/generate` runs it to the `interrupt()`; a new `POST /questions/approve` resumes it. `Interview.questions` keeps its current shape — no migration.

**Tech Stack:** Node.js 24, Express 5, Prisma/Postgres, `langchain` 1.x, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-question-generator-langgraph-pipeline-design.md`

## Global Constraints

- `@langchain/langgraph@^1.4.21` and `@langchain/langgraph-checkpoint-postgres@^1.0.6` — both verified peer-compatible with the already-installed `@langchain/core@^1.2.3` and `langchain@^1.5.4`.
- No Prisma migration. `Interview.questions` stays a plain `Array<{text, category, difficulty}>` — exact current shape.
- `thread_id = "${interviewId}:${jobId}"`, `jobId = crypto.randomUUID()` minted fresh per `/generate` call.
- `MAX_CONTENT_RETRIES = 2` in the validator loop; exactly one extra attempt after `fallback` (fallback does not reset `retryCount`, see spec §4.2).
- Backend test baseline before this work: 31/31 Vitest tests pass — keep green after every task.
- Frontend lint baseline: 5 pre-existing errors in files this plan does not touch (`CollaborativeEditor.tsx`, `DashboardLayout.tsx`, `InterviewRoom.tsx` lines 131/158/249) — don't add new ones to `InterviewRoom.tsx` beyond what Task 10 touches.
- `AI_MODEL_FALLBACK` env var, default `"gpt-4o"` if unset. `AI_MODEL` default stays `"gpt-4o-mini"`.
- `PATCH /interviews/:id` and its existing `questions` validation (`controller.js`) are untouched.

## Review Focus

- LeetCode MCP unavailable when `researcher` runs → must not throw; `research` stays `[]` and the graph proceeds (Task 3).
- `drafter` returns duplicate question text (same `text`, case-insensitive) → `validator` must catch it and retry, never let a duplicate reach `humanApproval` (Task 5).
- An approve request's `jobId` belongs to a different interview, or is malformed → `POST /questions/approve` must 404, never resume another interview's thread (Task 9).
- Rejecting (`approved:false`) must leave `interview.questions` completely untouched — no write happens on that path (Task 7's graph test, re-verified at the controller level in Task 9).
- `OPENAI_API_KEY` missing when `/generate` is called → 500 with an `AIConfigError`-shaped message, same externally-visible contract the old single-call implementation had (Task 9).

---

### Task 1: Shared schemas and error types

**Files:**
- Modify: `backend/package.json` (add `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`)
- Create: `backend/src/lib/agents/questionGenerator/state.js`
- Create: `backend/src/lib/agents/questionGenerator/errors.js`
- Test: `backend/src/lib/agents/questionGenerator/state.test.js`
- Test: `backend/src/lib/agents/questionGenerator/errors.test.js`

**Interfaces:**
- Produces: `QuestionSchema` (zod), `DraftResponseSchema` (zod, `{questions: QuestionSchema[]}`), `ResearchResponseSchema` (zod, `{usedLeetCode: boolean, notes: string}`), `QuestionGenState` (a `StateSchema` instance) from `state.js`. `AIConfigError`, `AIProviderError`, `AIInvalidResponseError` (all `extends Error`) from `errors.js`.

- [ ] **Step 1: Install dependencies**

Run: `cd backend && npm install @langchain/langgraph@^1.4.21 @langchain/langgraph-checkpoint-postgres@^1.0.6`

- [ ] **Step 2: Write the failing schema test**

```js
// backend/src/lib/agents/questionGenerator/state.test.js
import { describe, it, expect } from "vitest";
import { QuestionSchema, DraftResponseSchema, ResearchResponseSchema, QuestionGenState } from "./state.js";

describe("question generator schemas", () => {
  it("accepts a valid question", () => {
    const q = { text: "Explain closures", category: "technical", difficulty: "medium" };
    expect(QuestionSchema.parse(q)).toEqual(q);
  });

  it("rejects an invalid category", () => {
    expect(() =>
      QuestionSchema.parse({ text: "x", category: "nope", difficulty: "easy" }),
    ).toThrow();
  });

  it("DraftResponseSchema requires a questions array", () => {
    expect(() => DraftResponseSchema.parse({ questions: "not an array" })).toThrow();
    expect(
      DraftResponseSchema.parse({ questions: [{ text: "x", category: "technical", difficulty: "easy" }] }),
    ).toEqual({ questions: [{ text: "x", category: "technical", difficulty: "easy" }] });
  });

  it("ResearchResponseSchema requires usedLeetCode and notes", () => {
    expect(ResearchResponseSchema.parse({ usedLeetCode: true, notes: "n" })).toEqual({
      usedLeetCode: true,
      notes: "n",
    });
    expect(() => ResearchResponseSchema.parse({ usedLeetCode: true })).toThrow();
  });

  it("QuestionGenState fields default correctly when run through a graph", async () => {
    const { StateGraph, START, END } = await import("@langchain/langgraph");
    const graph = new StateGraph(QuestionGenState)
      .addNode("noop", async () => ({}))
      .addEdge(START, "noop")
      .addEdge("noop", END)
      .compile();
    const result = await graph.invoke({ interviewId: "i1", role: "r", interviewType: "technical", count: 3 });
    expect(result).toEqual({
      interviewId: "i1",
      role: "r",
      interviewType: "technical",
      count: 3,
      plan: null,
      research: [],
      draftQuestions: [],
      validationErrors: [],
      retryCount: 0,
      useFallbackModel: false,
      approval: null,
    });
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/state.test.js`
Expected: FAIL — `state.js` doesn't exist yet.

- [ ] **Step 4: Implement `state.js`**

```js
// backend/src/lib/agents/questionGenerator/state.js
import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const QuestionSchema = z.object({
  text: z.string(),
  category: z.enum(["technical", "behavioral", "system-design"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

export const DraftResponseSchema = z.object({
  questions: z.array(QuestionSchema),
});

export const ResearchResponseSchema = z.object({
  usedLeetCode: z.boolean(),
  notes: z.string(),
});

export const QuestionGenState = new StateSchema({
  interviewId: z.string(),
  role: z.string(),
  interviewType: z.string(),
  count: z.number(),
  plan: z.object({ categoryCounts: z.record(z.number()) }).nullable().default(null),
  research: z.array(z.string()).default(() => []),
  draftQuestions: z.array(QuestionSchema).default(() => []),
  validationErrors: z.array(z.string()).default(() => []),
  retryCount: z.number().default(0),
  useFallbackModel: z.boolean().default(false),
  approval: z
    .object({ approved: z.boolean(), questions: z.array(QuestionSchema).optional() })
    .nullable()
    .default(null),
});
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/state.test.js`
Expected: PASS (4 tests). If `QuestionGenState.getDefaultValues` doesn't exist on the installed version, the test's fallback branch covers it — either way all assertions after it must pass.

- [ ] **Step 6: Write the failing errors test**

```js
// backend/src/lib/agents/questionGenerator/errors.test.js
import { describe, it, expect } from "vitest";
import { AIConfigError, AIProviderError, AIInvalidResponseError } from "./errors.js";

describe("question generator error types", () => {
  it("are distinct Error subclasses", () => {
    expect(new AIConfigError("x")).toBeInstanceOf(Error);
    expect(new AIProviderError("x")).toBeInstanceOf(Error);
    expect(new AIInvalidResponseError("x")).toBeInstanceOf(Error);
    expect(new AIConfigError("x")).not.toBeInstanceOf(AIProviderError);
  });
});
```

- [ ] **Step 7: Run it, confirm it fails, then implement**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/errors.test.js` — expect FAIL (module missing).

```js
// backend/src/lib/agents/questionGenerator/errors.js
export class AIConfigError extends Error {}
export class AIProviderError extends Error {}
export class AIInvalidResponseError extends Error {}
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/errors.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/lib/agents/questionGenerator/state.js backend/src/lib/agents/questionGenerator/state.test.js backend/src/lib/agents/questionGenerator/errors.js backend/src/lib/agents/questionGenerator/errors.test.js
git commit -m "feat(ai): add LangGraph deps and question-generator state/error schemas"
```

---

### Task 2: `distributeCounts` helper and the `planner` node

**Files:**
- Create: `backend/src/lib/agents/questionGenerator/nodes.js`
- Test: `backend/src/lib/agents/questionGenerator/nodes.test.js`

**Interfaces:**
- Consumes: nothing from other tasks yet (pure function).
- Produces: `distributeCounts(count: number, weights: Record<string, number>): Record<string, number>` and `makePlannerNode(): (state) => Promise<{plan: {categoryCounts: Record<string,number>}}>`, both exported from `nodes.js`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/lib/agents/questionGenerator/nodes.test.js
import { describe, it, expect } from "vitest";
import { distributeCounts, makePlannerNode } from "./nodes.js";

describe("distributeCounts", () => {
  it("splits counts proportionally and sums to the total, largest remainder first", () => {
    const result = distributeCounts(6, { technical: 0.6, behavioral: 0.25, "system-design": 0.15 });
    expect(result).toEqual({ technical: 4, behavioral: 1, "system-design": 1 });
    expect(Object.values(result).reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe("planner node", () => {
  const plannerNode = makePlannerNode();

  it("biases toward behavioral for a behavioral interview", async () => {
    const result = await plannerNode({ interviewType: "behavioral", count: 6 });
    expect(result).toEqual({ plan: { categoryCounts: { behavioral: 4, technical: 2, "system-design": 0 } } });
  });

  it("defaults to the technical weighting for an unknown interviewType", async () => {
    const result = await plannerNode({ interviewType: "unknown-type", count: 6 });
    expect(result.plan.categoryCounts.technical).toBeGreaterThan(result.plan.categoryCounts.behavioral);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: FAIL — `nodes.js` doesn't exist.

- [ ] **Step 3: Implement**

```js
// backend/src/lib/agents/questionGenerator/nodes.js

export const distributeCounts = (count, weights) => {
  const categories = Object.keys(weights);
  const raw = categories.map((c) => count * weights[c]);
  const base = raw.map(Math.floor);
  const assigned = base.reduce((a, b) => a + b, 0);
  const remaining = count - assigned;
  const remainders = raw.map((r, i) => ({ i, frac: r - base[i] }));
  remainders.sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remaining; k++) base[remainders[k].i] += 1;
  return Object.fromEntries(categories.map((c, i) => [c, base[i]]));
};

const PLANNER_WEIGHTS = {
  technical: { technical: 0.6, behavioral: 0.25, "system-design": 0.15 },
  behavioral: { behavioral: 0.6, technical: 0.3, "system-design": 0.1 },
  "system-design": { "system-design": 0.6, technical: 0.3, behavioral: 0.1 },
};

export const makePlannerNode = () => async (state) => {
  const weights = PLANNER_WEIGHTS[state.interviewType] || PLANNER_WEIGHTS.technical;
  return { plan: { categoryCounts: distributeCounts(state.count, weights) } };
};
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/nodes.js backend/src/lib/agents/questionGenerator/nodes.test.js
git commit -m "feat(ai): add distributeCounts helper and planner node"
```

---

### Task 3: `researcher` node and its prompt

**Files:**
- Create: `backend/src/lib/agents/questionGenerator/prompts.js`
- Modify: `backend/src/lib/agents/questionGenerator/nodes.js` (add `makeResearcherNode`)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.test.js` (add researcher tests)

**Interfaces:**
- Consumes: `state.plan.categoryCounts` (Task 2).
- Produces: `buildResearcherPrompt(): string` from `prompts.js`; `makeResearcherNode({ buildResearcherAgent: () => Promise<{invoke: (input) => Promise<{structuredResponse: {usedLeetCode: boolean, notes: string}}>}> }): (state) => Promise<{research: string[]}>` from `nodes.js`. The injected `buildResearcherAgent` is how tests avoid real LLM/MCP calls — mirrors the existing `{ agent }` override pattern in the (soon to be removed) `questionGeneratorAgent.js`.

- [ ] **Step 1: Write the failing tests**

```js
// append to backend/src/lib/agents/questionGenerator/nodes.test.js
import { makeResearcherNode } from "./nodes.js";

describe("researcher node", () => {
  it("skips the agent entirely when the plan has no technical questions", async () => {
    const buildResearcherAgent = vi.fn();
    const node = makeResearcherNode({ buildResearcherAgent });
    const result = await node({ plan: { categoryCounts: { technical: 0, behavioral: 6 } } });
    expect(result).toEqual({ research: [] });
    expect(buildResearcherAgent).not.toHaveBeenCalled();
  });

  it("returns the agent's notes when it used LeetCode", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { usedLeetCode: true, notes: "Grounded in Two Sum" } }) };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent });
    const result = await node({ plan: { categoryCounts: { technical: 4 } }, role: "Backend Engineer", interviewType: "technical" });
    expect(result).toEqual({ research: ["Grounded in Two Sum"] });
  });

  it("returns no research when the agent chose not to use LeetCode", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { usedLeetCode: false, notes: "" } }) };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent });
    const result = await node({ plan: { categoryCounts: { technical: 4 } }, role: "x", interviewType: "technical" });
    expect(result).toEqual({ research: [] });
  });

  it("does not throw when the LeetCode MCP connection is unavailable (agent builder rejects)", async () => {
    const node = makeResearcherNode({ buildResearcherAgent: async () => { throw new Error("MCP connection failed"); } });
    await expect(
      node({ plan: { categoryCounts: { technical: 4 } }, role: "x", interviewType: "technical" }),
    ).resolves.toEqual({ research: [] });
  });
});
```

Add `import { vi } from "vitest";` to the test file's top-level import if not already present (it must be added alongside the existing `describe, it, expect` import).

- [ ] **Step 2: Run, confirm fail**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: FAIL — `makeResearcherNode` not exported.

- [ ] **Step 3: Implement the prompt and the node**

```js
// backend/src/lib/agents/questionGenerator/prompts.js
export const buildResearcherPrompt = () =>
  [
    "You help prepare technical interview questions by optionally grounding one in a real LeetCode problem.",
    "You have LeetCode problem-search tools available. Call search_problems or get_problem only if a concrete",
    "coding problem would genuinely strengthen a technical question for this role and interview type — this is",
    "your judgment call, not every request needs it.",
    "",
    "IMPORTANT: LeetCode's problem descriptions are copyrighted. If you use a tool result, do not copy its",
    "description verbatim — name the problem and topic, then describe it in your own words in `notes`.",
    "",
    "Respond with usedLeetCode (true only if you actually called a tool and are using its result) and notes",
    "(empty string if usedLeetCode is false).",
  ].join("\n");
```

```js
// add to backend/src/lib/agents/questionGenerator/nodes.js
export const makeResearcherNode = ({ buildResearcherAgent }) => async (state) => {
  if (!state.plan.categoryCounts.technical) return { research: [] };
  try {
    const agent = await buildResearcherAgent();
    const result = await agent.invoke({
      messages: [{ role: "user", content: `Role: ${state.role}\nInterview type: ${state.interviewType}` }],
    });
    const { usedLeetCode, notes } = result.structuredResponse;
    return { research: usedLeetCode ? [notes] : [] };
  } catch {
    return { research: [] };
  }
};
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/prompts.js backend/src/lib/agents/questionGenerator/nodes.js backend/src/lib/agents/questionGenerator/nodes.test.js
git commit -m "feat(ai): add researcher node with graceful LeetCode degradation"
```

---

### Task 4: `drafter` node and its prompt

**Files:**
- Modify: `backend/src/lib/agents/questionGenerator/prompts.js` (add `buildDrafterPrompt`)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.js` (add `makeDrafterNode`)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.test.js`

**Interfaces:**
- Consumes: `state.plan`, `state.research`, `state.useFallbackModel`, `state.count`, `state.role`, `state.interviewType`.
- Produces: `buildDrafterPrompt(): string`; `makeDrafterNode({ buildDrafterAgent: (useFallbackModel: boolean) => Promise<{invoke}> }): (state) => Promise<{draftQuestions: Question[]}>`.

- [ ] **Step 1: Write the failing tests**

```js
// append to backend/src/lib/agents/questionGenerator/nodes.test.js
import { makeDrafterNode } from "./nodes.js";

describe("drafter node", () => {
  const sampleQuestions = [{ text: "Explain closures", category: "technical", difficulty: "medium" }];

  it("returns the agent's drafted questions and passes the fallback flag through", async () => {
    const buildDrafterAgent = vi.fn().mockResolvedValue({
      invoke: vi.fn().mockResolvedValue({ structuredResponse: { questions: sampleQuestions } }),
    });
    const node = makeDrafterNode({ buildDrafterAgent });
    const result = await node({
      plan: { categoryCounts: { technical: 1 } },
      research: [],
      useFallbackModel: true,
      count: 1,
      role: "Backend Engineer",
      interviewType: "technical",
    });
    expect(result).toEqual({ draftQuestions: sampleQuestions });
    expect(buildDrafterAgent).toHaveBeenCalledWith(true);
  });

  it("includes research notes and the requested count in the user message", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { questions: sampleQuestions } }) };
    const node = makeDrafterNode({ buildDrafterAgent: async () => agent });
    await node({
      plan: { categoryCounts: { technical: 1 } },
      research: ["Grounded in Two Sum"],
      useFallbackModel: false,
      count: 1,
      role: "x",
      interviewType: "technical",
    });
    const content = agent.invoke.mock.calls[0][0].messages[0].content;
    expect(content).toContain("Grounded in Two Sum");
    expect(content).toContain("Generate exactly 1");
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: FAIL — `makeDrafterNode` not exported.

- [ ] **Step 3: Implement**

```js
// add to backend/src/lib/agents/questionGenerator/prompts.js
export const buildDrafterPrompt = () =>
  [
    "You are a senior technical interviewer at a top-tier software company.",
    "You write sharp, role-specific interview questions that probe real understanding, not trivia.",
    "",
    "You are given: the role, the interview type, a category/difficulty mix decided upstream, and optional",
    "research notes (possibly grounded in a real LeetCode problem). Do not second-guess the category mix —",
    "it was already decided; just draft questions that fit it.",
    "",
    "If research notes mention a LeetCode problem, you may reference it, but paraphrase in your own words —",
    "never copy a problem description verbatim.",
    "",
    "No duplicate or near-duplicate questions. Return exactly the requested count.",
  ].join("\n");
```

```js
// add to backend/src/lib/agents/questionGenerator/nodes.js
export const makeDrafterNode = ({ buildDrafterAgent }) => async (state) => {
  const agent = await buildDrafterAgent(state.useFallbackModel);
  const result = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: [
            `Generate exactly ${state.count} interview questions.`,
            `Role: ${state.role}`,
            `Interview type: ${state.interviewType}`,
            `Category mix: ${JSON.stringify(state.plan.categoryCounts)}`,
            `Research notes: ${state.research.length ? state.research.join(" ") : "none"}`,
          ].join("\n"),
        },
      ],
    },
    { recursionLimit: 10 },
  );
  return { draftQuestions: result.structuredResponse.questions };
};
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/prompts.js backend/src/lib/agents/questionGenerator/nodes.js backend/src/lib/agents/questionGenerator/nodes.test.js
git commit -m "feat(ai): add drafter node"
```

---

### Task 5: `validator` and `fallback` nodes

**Files:**
- Modify: `backend/src/lib/agents/questionGenerator/nodes.js` (add `validatorNode`, `fallbackNode`)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.test.js`

**Interfaces:**
- Consumes: `errors.js`'s `AIInvalidResponseError` (Task 1).
- Produces: `validatorNode(state) => Command` (goto one of `"humanApproval" | "drafter" | "fallback"`, or throws `AIInvalidResponseError`); `fallbackNode(state) => Promise<{useFallbackModel: true, retryCount: number}>`.

- [ ] **Step 1: Write the failing tests**

```js
// append to backend/src/lib/agents/questionGenerator/nodes.test.js
import { Command } from "@langchain/langgraph";
import { validatorNode, fallbackNode } from "./nodes.js";
import { AIInvalidResponseError } from "./errors.js";

describe("validator node", () => {
  const goodQuestions = [
    { text: "Explain closures", category: "technical", difficulty: "medium" },
    { text: "Describe a conflict you resolved", category: "behavioral", difficulty: "easy" },
  ];

  it("routes to humanApproval when the draft is valid", async () => {
    const result = await validatorNode({ draftQuestions: goodQuestions, count: 2, retryCount: 0, useFallbackModel: false });
    expect(result).toBeInstanceOf(Command);
    expect(result.goto).toEqual(["humanApproval"]);
    expect(result.update.validationErrors).toEqual([]);
  });

  it("catches a duplicate question and routes back to drafter while retries remain", async () => {
    const dup = [goodQuestions[0], { ...goodQuestions[0] }];
    const result = await validatorNode({ draftQuestions: dup, count: 2, retryCount: 0, useFallbackModel: false });
    expect(result.goto).toEqual(["drafter"]);
    expect(result.update.retryCount).toBe(1);
    expect(result.update.validationErrors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("routes to fallback once content retries are exhausted", async () => {
    const result = await validatorNode({ draftQuestions: [], count: 2, retryCount: 2, useFallbackModel: false });
    expect(result.goto).toEqual(["fallback"]);
  });

  it("throws AIInvalidResponseError when the fallback attempt also fails", async () => {
    await expect(
      validatorNode({ draftQuestions: [], count: 2, retryCount: 3, useFallbackModel: true }),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });

  it("catches a wrong question count", async () => {
    const result = await validatorNode({ draftQuestions: [goodQuestions[0]], count: 2, retryCount: 0, useFallbackModel: false });
    expect(result.goto).toEqual(["drafter"]);
    expect(result.update.validationErrors.some((e) => e.includes("expected 2"))).toBe(true);
  });
});

describe("fallback node", () => {
  it("sets useFallbackModel and bumps retryCount without resetting it", async () => {
    const result = await fallbackNode({ retryCount: 2 });
    expect(result).toEqual({ useFallbackModel: true, retryCount: 3 });
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: FAIL — `validatorNode`/`fallbackNode` not exported.

- [ ] **Step 3: Implement**

```js
// add to backend/src/lib/agents/questionGenerator/nodes.js
import { Command } from "@langchain/langgraph";
import { AIInvalidResponseError } from "./errors.js";

const MAX_CONTENT_RETRIES = 2;

const validateContent = (state) => {
  const errors = [];
  if (state.draftQuestions.length !== state.count) {
    errors.push(`expected ${state.count} questions, got ${state.draftQuestions.length}`);
  }
  const seen = new Set();
  for (const q of state.draftQuestions) {
    if (!q.text || !q.text.trim()) errors.push("empty question text");
    const key = q.text.trim().toLowerCase();
    if (seen.has(key)) errors.push(`duplicate question: "${q.text}"`);
    seen.add(key);
  }
  return errors;
};

export const validatorNode = async (state) => {
  const errors = validateContent(state);
  if (errors.length === 0) {
    return new Command({ update: { validationErrors: [] }, goto: "humanApproval" });
  }
  if (state.retryCount < MAX_CONTENT_RETRIES) {
    return new Command({
      update: { validationErrors: errors, retryCount: state.retryCount + 1 },
      goto: "drafter",
    });
  }
  if (!state.useFallbackModel) {
    return new Command({ update: { validationErrors: errors }, goto: "fallback" });
  }
  throw new AIInvalidResponseError(`Validation failed after fallback: ${errors.join("; ")}`);
};

export const fallbackNode = async (state) => ({
  useFallbackModel: true,
  retryCount: state.retryCount + 1,
});
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/nodes.js backend/src/lib/agents/questionGenerator/nodes.test.js
git commit -m "feat(ai): add validator and fallback nodes with bounded content retries"
```

---

### Task 6: `humanApproval` and `finalize` nodes

**Files:**
- Modify: `backend/src/lib/agents/questionGenerator/nodes.js` (add `humanApprovalNode`, `makeFinalizeNode`)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.test.js` (finalize only — see note)

**Interfaces:**
- Produces: `humanApprovalNode(state) => Command` (calls `interrupt()`; goto `"finalize" | END`); `makeFinalizeNode({ prisma: {interview: {update}} }): (state) => Promise<{}>`.

**Note:** `interrupt()` throws when called outside a running compiled graph (verified directly: `Called interrupt() outside the context of a graph.`), so `humanApprovalNode` cannot be meaningfully unit-tested in isolation — its behavior is verified in Task 7's graph-level integration test instead. This task only unit-tests `finalize`, which is pure.

- [ ] **Step 1: Write the failing finalize test**

```js
// append to backend/src/lib/agents/questionGenerator/nodes.test.js
import { makeFinalizeNode } from "./nodes.js";

describe("finalize node", () => {
  it("persists the approved (edited) questions, not the original draft", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = { interview: { update } };
    const node = makeFinalizeNode({ prisma });
    const edited = [{ text: "Edited question", category: "technical", difficulty: "hard" }];
    await node({ interviewId: "iv-1", draftQuestions: [{ text: "Original", category: "technical", difficulty: "easy" }], approval: { approved: true, questions: edited } });
    expect(update).toHaveBeenCalledWith({ where: { id: "iv-1" }, data: { questions: edited } });
  });

  it("falls back to the original draft when approval carries no edited questions", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = { interview: { update } };
    const node = makeFinalizeNode({ prisma });
    const draft = [{ text: "Original", category: "technical", difficulty: "easy" }];
    await node({ interviewId: "iv-1", draftQuestions: draft, approval: { approved: true } });
    expect(update).toHaveBeenCalledWith({ where: { id: "iv-1" }, data: { questions: draft } });
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: FAIL — `makeFinalizeNode` not exported.

- [ ] **Step 3: Implement both nodes**

```js
// add to backend/src/lib/agents/questionGenerator/nodes.js
import { interrupt, END } from "@langchain/langgraph";

export const humanApprovalNode = async (state) => {
  const decision = interrupt({ draftQuestions: state.draftQuestions, plan: state.plan });
  return new Command({
    update: { approval: decision },
    goto: decision.approved ? "finalize" : END,
  });
};

export const makeFinalizeNode = ({ prisma }) => async (state) => {
  const finalQuestions = state.approval?.questions ?? state.draftQuestions;
  await prisma.interview.update({
    where: { id: state.interviewId },
    data: { questions: finalQuestions },
  });
  return {};
};
```

(Combine this `import { interrupt, END } from "@langchain/langgraph"` with the existing `import { Command } from "@langchain/langgraph"` from Task 5 into one import statement at the top of the file.)

- [ ] **Step 4: Run, confirm pass**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/nodes.test.js`
Expected: PASS (17 tests total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/nodes.js backend/src/lib/agents/questionGenerator/nodes.test.js
git commit -m "feat(ai): add humanApproval and finalize nodes"
```

---

### Task 7: Graph wiring, in-memory integration tests, start/resume wrappers

**Files:**
- Create: `backend/src/lib/agents/questionGenerator/graph.js`
- Test: `backend/src/lib/agents/questionGenerator/graph.test.js`

**Interfaces:**
- Consumes: every node factory from `nodes.js` (Tasks 2–6), `QuestionGenState` (Task 1).
- Produces: `buildGraph({checkpointer?, buildResearcherAgent?, buildDrafterAgent?, prismaClient?}) => CompiledGraph`; `startQuestionGeneration({interviewId, role, interviewType, count}, {graph?}) => Promise<{jobId, draftQuestions, plan}>`; `resumeQuestionGeneration({interviewId, jobId, approved, questions?}, {graph?}) => Promise<{approved: boolean}>`. Both wrapper functions throw `AIProviderError` (from `errors.js`) on unexpected graph failure, or let a thrown `AIInvalidResponseError` pass through unchanged.

- [ ] **Step 1: Write the failing integration tests**

```js
// backend/src/lib/agents/questionGenerator/graph.test.js
import { describe, it, expect, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { buildGraph, startQuestionGeneration, resumeQuestionGeneration } from "./graph.js";
import { AIInvalidResponseError } from "./errors.js";

const goodQuestions = [
  { text: "Explain closures", category: "technical", difficulty: "medium" },
  { text: "Describe a conflict you resolved", category: "behavioral", difficulty: "easy" },
];

const makeDeps = ({ draftQuestions = goodQuestions, update = vi.fn().mockResolvedValue({}) } = {}) => ({
  checkpointer: new MemorySaver(),
  buildResearcherAgent: async () => ({ invoke: vi.fn().mockResolvedValue({ structuredResponse: { usedLeetCode: false, notes: "" } }) }),
  buildDrafterAgent: async () => ({ invoke: vi.fn().mockResolvedValue({ structuredResponse: { questions: draftQuestions } }) }),
  prismaClient: { interview: { update } },
});

describe("question generator graph", () => {
  it("runs to the human approval interrupt and returns the draft", async () => {
    const graph = buildGraph(makeDeps());
    const result = await startQuestionGeneration(
      { interviewId: "iv-1", role: "Backend Engineer", interviewType: "technical", count: 2 },
      { graph },
    );
    expect(result.jobId).toBeTypeOf("string");
    expect(result.draftQuestions).toEqual(goodQuestions);
    expect(result.plan.categoryCounts).toBeDefined();
  });

  it("persists on approve and reports approved: true", async () => {
    const update = vi.fn().mockResolvedValue({});
    const deps = makeDeps({ update });
    const graph = buildGraph(deps);
    const { jobId } = await startQuestionGeneration(
      { interviewId: "iv-2", role: "x", interviewType: "technical", count: 2 },
      { graph },
    );
    const result = await resumeQuestionGeneration(
      { interviewId: "iv-2", jobId, approved: true, questions: goodQuestions },
      { graph },
    );
    expect(result).toEqual({ approved: true });
    expect(update).toHaveBeenCalledWith({ where: { id: "iv-2" }, data: { questions: goodQuestions } });
  });

  it("does not write to the database on reject", async () => {
    const update = vi.fn().mockResolvedValue({});
    const deps = makeDeps({ update });
    const graph = buildGraph(deps);
    const { jobId } = await startQuestionGeneration(
      { interviewId: "iv-3", role: "x", interviewType: "technical", count: 2 },
      { graph },
    );
    const result = await resumeQuestionGeneration(
      { interviewId: "iv-3", jobId, approved: false },
      { graph },
    );
    expect(result).toEqual({ approved: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("reaches fallback then throws AIInvalidResponseError when the draft is always invalid", async () => {
    const deps = makeDeps({ draftQuestions: [] }); // always fails the count check
    const graph = buildGraph(deps);
    await expect(
      startQuestionGeneration(
        { interviewId: "iv-4", role: "x", interviewType: "technical", count: 2 },
        { graph },
      ),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/graph.test.js`
Expected: FAIL — `graph.js` doesn't exist.

- [ ] **Step 3: Implement**

```js
// backend/src/lib/agents/questionGenerator/graph.js
import crypto from "node:crypto";
import { StateGraph, START, END, MemorySaver, Command } from "@langchain/langgraph";
import { createAgent } from "langchain";
import { prisma } from "../../db.js";
import { getLeetCodeTools } from "../leetcodeMcpClient.js";
import { QuestionGenState, DraftResponseSchema, ResearchResponseSchema } from "./state.js";
import { buildResearcherPrompt, buildDrafterPrompt } from "./prompts.js";
import {
  makePlannerNode,
  makeResearcherNode,
  makeDrafterNode,
  validatorNode,
  fallbackNode,
  humanApprovalNode,
  makeFinalizeNode,
} from "./nodes.js";
import { AIProviderError, AIInvalidResponseError } from "./errors.js";

const defaultBuildResearcherAgent = async () => {
  const tools = await getLeetCodeTools();
  return createAgent({
    model: `openai:${process.env.AI_MODEL || "gpt-4o-mini"}`,
    tools,
    systemPrompt: buildResearcherPrompt(),
    responseFormat: ResearchResponseSchema,
  });
};

const defaultBuildDrafterAgent = async (useFallbackModel) =>
  createAgent({
    model: `openai:${
      useFallbackModel ? process.env.AI_MODEL_FALLBACK || "gpt-4o" : process.env.AI_MODEL || "gpt-4o-mini"
    }`,
    tools: [],
    systemPrompt: buildDrafterPrompt(),
    responseFormat: DraftResponseSchema,
  });

export const buildGraph = ({
  checkpointer,
  buildResearcherAgent = defaultBuildResearcherAgent,
  buildDrafterAgent = defaultBuildDrafterAgent,
  prismaClient = prisma,
} = {}) =>
  new StateGraph(QuestionGenState)
    .addNode("planner", makePlannerNode())
    .addNode("researcher", makeResearcherNode({ buildResearcherAgent }), { retryPolicy: { maxAttempts: 3 } })
    .addNode("drafter", makeDrafterNode({ buildDrafterAgent }), { retryPolicy: { maxAttempts: 3 } })
    .addNode("validator", validatorNode, { ends: ["humanApproval", "drafter", "fallback"] })
    .addNode("fallback", fallbackNode)
    .addNode("humanApproval", humanApprovalNode, { ends: ["finalize", END] })
    .addNode("finalize", makeFinalizeNode({ prisma: prismaClient }))
    .addEdge(START, "planner")
    .addEdge("planner", "researcher")
    .addEdge("researcher", "drafter")
    .addEdge("drafter", "validator")
    .addEdge("fallback", "drafter")
    .addEdge("finalize", END)
    .compile({ checkpointer: checkpointer || new MemorySaver() });

let defaultGraph;
const getDefaultGraph = () => {
  if (!defaultGraph) defaultGraph = buildGraph();
  return defaultGraph;
};

export const startQuestionGeneration = async ({ interviewId, role, interviewType, count }, { graph } = {}) => {
  const runGraph = graph || getDefaultGraph();
  const jobId = crypto.randomUUID();
  const threadId = `${interviewId}:${jobId}`;
  let result;
  try {
    result = await runGraph.invoke(
      { interviewId, role, interviewType, count },
      { configurable: { thread_id: threadId } },
    );
  } catch (err) {
    if (err instanceof AIInvalidResponseError) throw err;
    throw new AIProviderError(err.message);
  }
  const pending = result.__interrupt__?.[0]?.value;
  if (!pending) throw new AIProviderError("Graph finished without reaching approval");
  return { jobId, draftQuestions: pending.draftQuestions, plan: pending.plan };
};

export const resumeQuestionGeneration = async ({ interviewId, jobId, approved, questions }, { graph } = {}) => {
  const runGraph = graph || getDefaultGraph();
  const threadId = `${interviewId}:${jobId}`;
  try {
    await runGraph.invoke(new Command({ resume: { approved, questions } }), {
      configurable: { thread_id: threadId },
    });
  } catch (err) {
    if (err instanceof AIInvalidResponseError) throw err;
    throw new AIProviderError(err.message);
  }
  return { approved };
};
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/graph.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole backend suite to confirm no regression**

Run: `cd backend && npm test`
Expected: all prior tests plus these new ones pass (old `questionGeneratorAgent.js`/`aiController.js` untouched so far — still green).

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/graph.js backend/src/lib/agents/questionGenerator/graph.test.js
git commit -m "feat(ai): wire the question-generator StateGraph with start/resume wrappers"
```

---

### Task 8: Postgres checkpointer and boot-time setup

**Files:**
- Modify: `backend/src/lib/agents/questionGenerator/graph.js` (add `getCheckpointer`, `ensureCheckpointerTables`, use `getCheckpointer()` in `getDefaultGraph`)
- Modify: `backend/src/server.js` (call `ensureCheckpointerTables()` at boot)
- Modify: `backend/.env.example` (add `AI_MODEL_FALLBACK`)

**Interfaces:**
- Produces: `getCheckpointer(): PostgresSaver` (memoized singleton); `ensureCheckpointerTables(): Promise<void>`.

- [ ] **Step 1: Implement the checkpointer functions**

```js
// add to backend/src/lib/agents/questionGenerator/graph.js
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let pgCheckpointer;
export const getCheckpointer = () => {
  if (!pgCheckpointer) pgCheckpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL);
  return pgCheckpointer;
};

export const ensureCheckpointerTables = () => getCheckpointer().setup();
```

Change `getDefaultGraph` to use it:

```js
const getDefaultGraph = () => {
  if (!defaultGraph) defaultGraph = buildGraph({ checkpointer: getCheckpointer() });
  return defaultGraph;
};
```

- [ ] **Step 2: Wire boot-time setup in `server.js`**

Find the existing boot block (around the `getLeetCodeTools().catch(() => {})` line) and add the checkpointer warm-up right after it:

```js
import { ensureCheckpointerTables } from "./lib/agents/questionGenerator/graph.js";
// ...
getLeetCodeTools().catch(() => {});
// Create the LangGraph checkpointer's Postgres tables if they don't exist yet (idempotent).
// Best-effort: question generation will still fail clearly per-request if this never succeeds,
// but a slow/missing DB at boot must not crash the whole server.
ensureCheckpointerTables().catch((err) => console.error("Checkpointer setup failed:", err.message));
```

- [ ] **Step 3: Add the new env var to the example file**

```bash
# backend/.env.example — append
AI_MODEL_FALLBACK=gpt-4o
```

- [ ] **Step 4: Run the backend suite to confirm no regression**

Run: `cd backend && npm test`
Expected: still green — nothing in the suite exercises `getCheckpointer`/`ensureCheckpointerTables` against a real database (both are swapped out via `buildGraph`'s `checkpointer` override in every test).

- [ ] **Step 5: Manual verification against the real dev database**

This step needs the local Postgres running — not part of the automated suite.

```bash
docker compose up -d
cd backend
node -e "import('./src/lib/agents/questionGenerator/graph.js').then(m => m.ensureCheckpointerTables()).then(() => { console.log('checkpointer tables ready'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); })"
```

Expected: prints `checkpointer tables ready` with exit code 0. If it fails, check `DATABASE_URL` in `backend/.env` matches the running container (`postgresql://talentiq:talentiq_secret@127.0.0.1:6300/talentiq` per the root `docker-compose.yml`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/graph.js backend/src/server.js backend/.env.example
git commit -m "feat(ai): add Postgres-backed checkpointer, warmed at boot"
```

---

### Task 9: Controller/route cutover and removal of the old agent module

**Files:**
- Modify: `backend/src/controllers/controller.js` (export `toInterviewDoc`, `INTERVIEWER_SELECT`)
- Modify: `backend/src/controllers/aiController.js` (rewrite `generateQuestions`, add `approveQuestions`)
- Modify: `backend/src/controllers/aiController.test.js` (update mocks/assertions, add approve tests)
- Modify: `backend/src/routes/interview.routes.js` (add the approve route)
- Delete: `backend/src/lib/agents/questionGeneratorAgent.js`
- Delete: `backend/src/lib/agents/questionGeneratorAgent.test.js`
- Delete: `backend/src/lib/agents/prompts/questionGenerator.js` (superseded by `questionGenerator/prompts.js`)

**Interfaces:**
- Consumes: `startQuestionGeneration`, `resumeQuestionGeneration` (Task 7), `AIConfigError`/`AIProviderError`/`AIInvalidResponseError` (Task 1), `toInterviewDoc`/`INTERVIEWER_SELECT` (this task, from `controller.js`).

- [ ] **Step 1: Export the two helpers from `controller.js`**

In `backend/src/controllers/controller.js`, change:
```js
const toInterviewDoc = (iv) => {
```
to:
```js
export const toInterviewDoc = (iv) => {
```
and change:
```js
const INTERVIEWER_SELECT = {
```
to:
```js
export const INTERVIEWER_SELECT = {
```

- [ ] **Step 2: Write the failing controller tests**

Replace the entire contents of `backend/src/controllers/aiController.test.js`:

```js
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
}));

import { prisma } from "../lib/db.js";
import { startQuestionGeneration, resumeQuestionGeneration } from "../lib/agents/questionGenerator/graph.js";
import { AIProviderError } from "../lib/agents/questionGenerator/errors.js";
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
    await generateQuestions(baseReq, res);
    expect(res.status).toHaveBeenCalledWith(500);
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

  it("returns 404 when jobId does not belong to this interview", async () => {
    const res = mockRes();
    await approveQuestions({ ...baseReq, params: { id: "iv-1" }, body: { jobId: "iv-OTHER:abc", approved: true } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(resumeQuestionGeneration).not.toHaveBeenCalled();
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
```

- [ ] **Step 3: Run, confirm fail**

Run: `cd backend && npx vitest run src/controllers/aiController.test.js`
Expected: FAIL — `approveQuestions` doesn't exist, old module still imported by the old test.

- [ ] **Step 4: Rewrite `aiController.js`**

```js
// backend/src/controllers/aiController.js
import { prisma } from "../lib/db.js";
import { startQuestionGeneration, resumeQuestionGeneration } from "../lib/agents/questionGenerator/graph.js";
import { AIProviderError, AIInvalidResponseError, AIConfigError } from "../lib/agents/questionGenerator/errors.js";
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
    if (!jobId.startsWith(`${req.params.id}:`)) {
      return res.status(404).json({ message: "Unknown job for this interview" });
    }

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
    return res.status(500).json({ message: "Failed to resolve approval", error: err.message });
  }
};

export default { generateQuestions, approveQuestions };
```

- [ ] **Step 5: Add the approve route**

In `backend/src/routes/interview.routes.js`, change:
```js
router.post("/:id/questions/generate", protectRoute, aiController.generateQuestions);
```
to:
```js
router.post("/:id/questions/generate", protectRoute, aiController.generateQuestions);
router.post("/:id/questions/approve", protectRoute, aiController.approveQuestions);
```

- [ ] **Step 6: Delete the superseded files**

```bash
git rm backend/src/lib/agents/questionGeneratorAgent.js backend/src/lib/agents/questionGeneratorAgent.test.js backend/src/lib/agents/prompts/questionGenerator.js
```

(If `backend/src/lib/agents/prompts/` is now empty, it's removed automatically by `git rm` — no separate step needed.)

- [ ] **Step 7: Run, confirm pass**

Run: `cd backend && npx vitest run src/controllers/aiController.test.js`
Expected: PASS (9 tests).

- [ ] **Step 8: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all tests pass, no reference to the deleted module remains.

- [ ] **Step 9: Commit**

```bash
git add backend/src/controllers/controller.js backend/src/controllers/aiController.js backend/src/controllers/aiController.test.js backend/src/routes/interview.routes.js
git rm backend/src/lib/agents/questionGeneratorAgent.js backend/src/lib/agents/questionGeneratorAgent.test.js backend/src/lib/agents/prompts/questionGenerator.js
git commit -m "feat(ai): cut over to the LangGraph question-generator pipeline"
```

---

### Task 10: Frontend — approve/discard flow in `QuestionsPanel`

**Files:**
- Modify: `frontend/src/pages/InterviewRoom.tsx`

**Interfaces:**
- Consumes: the new `generate` response shape `{jobId, status, draftQuestions, plan}` and the new `POST /interviews/:id/questions/approve` endpoint (Task 9).

- [ ] **Step 1: Add `jobId` state and update the generate handler**

In `InterviewRoom.tsx`, inside `QuestionsPanel`, find the generate handler (around the `fetch(\`${API}/interviews/${interviewId}/questions/generate\`` call). Add a `jobId` state variable next to the existing `questions`/`loading`/`error` state:

```tsx
const [jobId, setJobId] = React.useState<string | null>(null);
```

Change the line that currently does:
```tsx
setQuestions(body.questions);
```
to:
```tsx
setJobId(body.jobId);
setQuestions(body.draftQuestions);
```

- [ ] **Step 2: Replace the save handler to call `/approve`**

Find the save handler (the one that currently does `fetch(... , { method: "PATCH", body: JSON.stringify({ questions }) })`). Replace its body with a call to the new endpoint:

```tsx
const saveQuestions = async (approved: boolean) => {
  if (!jobId) return;
  const r = await fetch(`${API}/interviews/${interviewId}/questions/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-clerk-id': clerkId },
    body: JSON.stringify({ jobId, approved, questions: approved ? questions : undefined }),
  });
  const body = await r.json();
  if (!r.ok) {
    setError(body?.message || 'Failed to save questions');
    return;
  }
  if (approved) {
    onSaved(body.questions);
    setJobId(null);
  } else {
    setQuestions([]);
    setJobId(null);
  }
};
```

(Match the exact existing header/error-handling style already present in this component — the surrounding `fetch` calls in this file already set `x-clerk-id`; reuse that pattern rather than introducing a new one.)

- [ ] **Step 3: Wire the two buttons**

Find the existing "Save questions" button JSX (inside the `{questions.length > 0 && (...)}` block). Change its `onClick` to `() => saveQuestions(true)`, and add a "Discard" button next to it calling `() => saveQuestions(false)`.

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && npm run build`
Expected: succeeds (the `tsc -b` step must not report new errors in `InterviewRoom.tsx`).

Run: `cd frontend && npm run lint`
Expected: same 5 pre-existing errors as the baseline, none of them new, none of them removed by this change (this task doesn't touch the lines they're on).

- [ ] **Step 5: Manual smoke check**

With the backend running (`cd backend && npm run dev`) and frontend running (`cd frontend && npm run dev`), open an interview room as the interviewer, go to the Questions tab, click "Generate questions", confirm the draft rows render, edit one, click "Save questions", confirm it persists (reload the page, the edited row is still there). Then generate again and click "Discard", confirm nothing was saved.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/InterviewRoom.tsx
git commit -m "feat(ui): approve/discard flow for generated interview questions"
```
