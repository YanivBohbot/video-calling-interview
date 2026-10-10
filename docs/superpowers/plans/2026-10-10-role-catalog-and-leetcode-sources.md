# Role Catalog, Visible LeetCode Sources, Better Research — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give New Interview a two-dropdown role picker (18 catalog roles + custom), make LeetCode-grounded questions carry a verified, visible source badge, and make research pick distinct, role-relevant problems.

**Architecture:** The researcher returns only slugs. Code keeps the ones that actually appeared in this run's LeetCode tool results, and takes title/difficulty from those results. The drafter tags each technical question with a `sourceSlug`, which a pure `attachSources` step turns into a full `source` with a URL built in code. The validator rejects two questions sharing one problem. The shared payload validator checks `source` on PATCH and `/approve`. The frontend changes are a role picker and a badge.

**Tech Stack:** Node 24, Express 5, LangGraph JS, LangChain `createAgent` (`toolStrategy` for the researcher), zod 3, Vitest; React 19 + TS + Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-10-role-catalog-and-leetcode-sources-design.md`

## Global Constraints

- `Interview.role` stays a plain string; `Interview.questions` stays a JSON array. No Prisma migration.
- `source` shape exactly: `{ type: "leetcode", title, slug, difficulty, url }`, `url === "https://leetcode.com/problems/<slug>/"`, built in code — never from model output.
- The model may only cite slugs seen in this run's LeetCode tool results.
- `source` only ever on `category: "technical"` questions.
- Backend baseline before this plan: `cd backend && npm test` → 72/72 pass. Keep green after every task.
- Frontend lint baseline: 5 errors / 2 warnings, all pre-existing. Don't add new ones.
- Researcher keeps `toolStrategy` structured output (native strict mode 400s on the LeetCode MCP schemas).

## Review Focus

- Model returns a slug that no tool returned (hallucinated) → it must never become a badge or link (Task 1 `pickResearchProblems` + Task 3 `attachSources` tests).
- Model puts a `sourceSlug` on a behavioral/system-design question → the source is dropped (Task 3).
- A client PATCHes/approves a question whose `source.url` points somewhere other than `leetcode.com/problems/<slug>/` (e.g. `javascript:` or a phishing URL) → 400 (Task 4).
- Old saved questions without `source` → still load, edit, PATCH and approve fine (Task 4 "no source passes"; Task 6 badge only when present).
- "Custom…" role chosen with empty text → form can't submit (Task 5, `required` on the custom input).

---

### Task 1: Source helpers and schemas

**Files:**
- Create: `backend/src/lib/agents/questionGenerator/sources.js`
- Create: `backend/src/lib/agents/questionGenerator/sources.test.js`
- Modify: `backend/src/lib/agents/questionGenerator/state.js`

**Interfaces:**
- Produces:
  - from `sources.js`: `leetcodeUrl(slug): string`, `collectSeenProblems(messages): Map<slug, {slug,title,difficulty}>`, `pickResearchProblems(chosen: {slug}[] | undefined, seen, max): {slug,title,difficulty}[]`, `attachSources(drafts: {text,category,difficulty,sourceSlug?}[], research): Question[]`
  - from `state.js`: `SourceSchema`, `ResearchProblemSchema`; `QuestionSchema` gains optional `source`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/lib/agents/questionGenerator/sources.test.js
import { describe, it, expect } from "vitest";
import { ToolMessage, AIMessage } from "@langchain/core/messages";
import { leetcodeUrl, collectSeenProblems, pickResearchProblems, attachSources } from "./sources.js";
import { QuestionSchema } from "./state.js";

const searchResult = (questions) =>
  new ToolMessage({
    content: JSON.stringify({ problems: { total: questions.length, questions } }),
    tool_call_id: "call-1",
    name: "search_problems",
  });

const A = { title: "Second Highest Salary", titleSlug: "second-highest-salary", difficulty: "Medium" };
const B = { title: "Rank Scores", titleSlug: "rank-scores", difficulty: "Medium" };

describe("leetcodeUrl", () => {
  it("builds the canonical problem URL from a slug", () => {
    expect(leetcodeUrl("two-sum")).toBe("https://leetcode.com/problems/two-sum/");
  });
});

describe("collectSeenProblems", () => {
  it("collects problems from tool messages only, ignoring the model's own text", () => {
    const seen = collectSeenProblems([
      new AIMessage(JSON.stringify({ titleSlug: "made-up", title: "Made Up", difficulty: "Easy" })),
      searchResult([A, B]),
    ]);
    expect([...seen.keys()]).toEqual(["second-highest-salary", "rank-scores"]);
    expect(seen.get("rank-scores")).toEqual({ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" });
  });

  it("ignores tool output that isn't JSON", () => {
    const seen = collectSeenProblems([new ToolMessage({ content: "rate limited", tool_call_id: "x", name: "search_problems" })]);
    expect(seen.size).toBe(0);
  });
});

describe("pickResearchProblems", () => {
  const seen = collectSeenProblems([searchResult([A, B])]);

  it("drops slugs no tool returned, de-duplicates, and caps at max", () => {
    const picked = pickResearchProblems(
      [{ slug: "ghost-problem" }, { slug: "rank-scores" }, { slug: "rank-scores" }, { slug: "second-highest-salary" }],
      seen,
      1,
    );
    expect(picked).toEqual([{ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" }]);
  });

  it("tolerates a missing problem list", () => {
    expect(pickResearchProblems(undefined, seen, 3)).toEqual([]);
  });
});

describe("attachSources", () => {
  const research = [{ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" }];

  it("turns a known slug on a technical question into a full source with a built URL", () => {
    const [q] = attachSources([{ text: "Rank players", category: "technical", difficulty: "medium", sourceSlug: "rank-scores" }], research);
    expect(q).toEqual({
      text: "Rank players",
      category: "technical",
      difficulty: "medium",
      source: { type: "leetcode", title: "Rank Scores", slug: "rank-scores", difficulty: "Medium", url: "https://leetcode.com/problems/rank-scores/" },
    });
    expect(QuestionSchema.parse(q)).toEqual(q);
  });

  it("drops a slug that isn't in the research list", () => {
    const [q] = attachSources([{ text: "T", category: "technical", difficulty: "easy", sourceSlug: "invented-slug" }], research);
    expect(q).toEqual({ text: "T", category: "technical", difficulty: "easy" });
  });

  it("never attaches a source to a behavioral or system-design question", () => {
    const out = attachSources(
      [
        { text: "B", category: "behavioral", difficulty: "easy", sourceSlug: "rank-scores" },
        { text: "S", category: "system-design", difficulty: "hard", sourceSlug: "rank-scores" },
      ],
      research,
    );
    expect(out.every((q) => q.source === undefined)).toBe(true);
  });

  it("leaves questions without a sourceSlug unchanged", () => {
    const q = { text: "Plain", category: "technical", difficulty: "easy" };
    expect(attachSources([q], research)).toEqual([q]);
  });
});
```

- [ ] **Step 2: Run, confirm RED**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/sources.test.js`
Expected: FAIL — `Cannot find module './sources.js'`.

- [ ] **Step 3: Add schemas to `state.js`**

In `backend/src/lib/agents/questionGenerator/state.js`, replace the `QuestionSchema` declaration with:

```js
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
```

- [ ] **Step 4: Implement `sources.js`**

```js
// backend/src/lib/agents/questionGenerator/sources.js
import { ToolMessage } from "@langchain/core/messages";

export const leetcodeUrl = (slug) => `https://leetcode.com/problems/${slug}/`;

const contentText = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("");
  return "";
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const walk = (node, found) => {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, found));
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.titleSlug === "string" && typeof node.title === "string" && !found.has(node.titleSlug)) {
    found.set(node.titleSlug, {
      slug: node.titleSlug,
      title: node.title,
      difficulty: typeof node.difficulty === "string" ? node.difficulty : "Unknown",
    });
  }
  Object.values(node).forEach((v) => walk(v, found));
};

// Only problems a LeetCode tool actually returned this run may be cited, so a
// slug the model invents can never become a badge or a link.
export const collectSeenProblems = (messages = []) => {
  const found = new Map();
  for (const m of messages) {
    if (ToolMessage.isInstance(m)) walk(parseJson(contentText(m.content)), found);
  }
  return found;
};

export const pickResearchProblems = (chosen, seen, max) => {
  const picked = [];
  for (const { slug } of chosen ?? []) {
    if (picked.length >= max) break;
    const problem = seen.get(slug);
    if (problem && !picked.some((p) => p.slug === slug)) picked.push(problem);
  }
  return picked;
};

// The model only names a slug; title, difficulty and URL come from the tool result
// and from code, and only technical questions may carry a source.
export const attachSources = (drafts, research) => {
  const bySlug = new Map(research.map((p) => [p.slug, p]));
  return drafts.map(({ sourceSlug, ...question }) => {
    const problem = question.category === "technical" && sourceSlug ? bySlug.get(sourceSlug) : undefined;
    if (!problem) return question;
    return {
      ...question,
      source: {
        type: "leetcode",
        title: problem.title,
        slug: problem.slug,
        difficulty: problem.difficulty,
        url: leetcodeUrl(problem.slug),
      },
    };
  });
};
```

- [ ] **Step 5: Run, confirm GREEN + full suite**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/sources.test.js && npm test`
Expected: sources tests 9/9 PASS; full suite 81/81 PASS (72 + 9).

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/sources.js backend/src/lib/agents/questionGenerator/sources.test.js backend/src/lib/agents/questionGenerator/state.js
git commit -m "feat(ai): add verified LeetCode source helpers and schemas"
```

---

### Task 2: Researcher returns distinct, verified, role-relevant problems

**Files:**
- Modify: `backend/src/lib/agents/questionGenerator/state.js` (`ResearchResponseSchema`, `research` field)
- Modify: `backend/src/lib/agents/questionGenerator/prompts.js` (`buildResearcherPrompt`)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.js` (`makeResearcherNode`; drafter's research line)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.test.js`, `state.test.js`, `graph.test.js`

**Interfaces:**
- Consumes: `collectSeenProblems`, `pickResearchProblems` (Task 1), `ResearchProblemSchema` (Task 1).
- Produces: `makeResearcherNode({ buildResearcherAgent, random = Math.random })` → `{ research: {slug,title,difficulty}[] }`. `ResearchResponseSchema = { problems: {slug}[] }`.

- [ ] **Step 1: Update tests (RED)**

In `state.test.js`, replace the `ResearchResponseSchema` test with:

```js
  it("ResearchResponseSchema is a list of chosen slugs", () => {
    expect(ResearchResponseSchema.parse({ problems: [{ slug: "two-sum" }] })).toEqual({ problems: [{ slug: "two-sum" }] });
    expect(() => ResearchResponseSchema.parse({ usedLeetCode: true, notes: "n" })).toThrow();
  });
```

In `nodes.test.js`, add `import { ToolMessage } from "@langchain/core/messages";` to the imports, and replace the two tests `"returns the agent's notes when it used LeetCode"` and `"returns no research when the agent chose not to use LeetCode"` with:

```js
  const toolResult = new ToolMessage({
    content: JSON.stringify({
      problems: {
        questions: [
          { title: "Second Highest Salary", titleSlug: "second-highest-salary", difficulty: "Medium" },
          { title: "Rank Scores", titleSlug: "rank-scores", difficulty: "Medium" },
        ],
      },
    }),
    tool_call_id: "call-1",
    name: "search_problems",
  });

  it("keeps only tool-returned, distinct problems, capped at the technical question count", async () => {
    const agent = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          problems: [{ slug: "ghost" }, { slug: "rank-scores" }, { slug: "rank-scores" }, { slug: "second-highest-salary" }],
        },
        messages: [toolResult],
      }),
    };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent, random: () => 0 });
    const result = await node({ plan: { categoryCounts: { technical: 1 } }, role: "Senior Backend Engineer", interviewType: "technical" });
    expect(result).toEqual({ research: [{ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" }] });
  });

  it("tells the agent how many problems it needs and a varied search offset", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { problems: [] }, messages: [] }) };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent, random: () => 0.5 });
    await node({ plan: { categoryCounts: { technical: 3 } }, role: "Junior Frontend Engineer", interviewType: "technical" });
    const content = agent.invoke.mock.calls[0][0].messages[0].content;
    expect(content).toContain("Junior Frontend Engineer");
    expect(content).toContain("Technical questions to ground: 3");
    expect(content).toContain("offset 20");
  });

  it("returns no research when the agent picked nothing", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { problems: [] }, messages: [toolResult] }) };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent });
    expect(await node({ plan: { categoryCounts: { technical: 2 } }, role: "x", interviewType: "technical" })).toEqual({ research: [] });
  });
```

In `nodes.test.js`, in the drafter test `"includes research notes and the requested count in the user message"`, change `research: ["Grounded in Two Sum"]` to `research: [{ slug: "two-sum", title: "Two Sum", difficulty: "Easy" }]` and `expect(content).toContain("Grounded in Two Sum")` to `expect(content).toContain("two-sum — Two Sum (Easy)")`.

In `graph.test.js` `makeDeps`, change the researcher mock's resolved value to `{ structuredResponse: { problems: [] }, messages: [] }`.

- [ ] **Step 2: Run, confirm RED**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/`
Expected: FAIL. The new researcher tests and the `ResearchResponseSchema` test fail; the drafter research test fails on `"two-sum — Two Sum (Easy)"`.

- [ ] **Step 3: Update `state.js`**

Replace `ResearchResponseSchema` with:

```js
// The model names slugs only; facts come from the tool results (see sources.js).
export const ResearchResponseSchema = z.object({
  problems: z.array(z.object({ slug: z.string() })),
});
```

and change the state field `research: z.array(z.string()).default(() => []),` to `research: z.array(ResearchProblemSchema).default(() => []),`. `ResearchProblemSchema` must be declared above `QuestionGenState`.

- [ ] **Step 4: Rewrite `buildResearcherPrompt` in `prompts.js`**

```js
export const buildResearcherPrompt = () =>
  [
    "You pick real LeetCode problems to ground technical interview questions.",
    "Use search_problems (and get_problem only to confirm a specific problem). Do not use get_daily_challenge.",
    "",
    "- Choose category, tags and keywords that fit the role. Examples: backend → database, design, hash-table,",
    "  concurrency; frontend → javascript, string, array; data/ML → array, math, dynamic-programming, pandas;",
    "  devops → shell, concurrency, graph; full-stack → mix backend and frontend topics.",
    "- Choose difficulty from the seniority in the role title: Junior → EASY, Mid-level → MEDIUM,",
    "  Senior → MEDIUM or HARD. If the title has no seniority, infer it.",
    "- Use the offset you are given for your first search, so repeated runs surface different problems.",
    "- Return up to the requested number of DISTINCT problems on different topics, as their titleSlug values",
    "  exactly as a tool returned them. Never invent or modify a slug.",
    "- If nothing fits the role, return an empty list.",
  ].join("\n");
```

- [ ] **Step 5: Update the researcher node and the drafter's research line in `nodes.js`**

Add to the imports: `import { collectSeenProblems, pickResearchProblems } from "./sources.js";`

Replace `makeResearcherNode` with:

```js
// Grounding is optional: an unreachable LeetCode MCP server must degrade to no
// research, never fail the whole generation.
export const makeResearcherNode = ({ buildResearcherAgent, random = Math.random }) => async (state) => {
  const technicalCount = state.plan.categoryCounts.technical || 0;
  if (!technicalCount) return { research: [] };
  try {
    const agent = await buildResearcherAgent();
    const offset = Math.floor(random() * 41);
    const result = await agent.invoke({
      messages: [
        {
          role: "user",
          content: [
            `Role: ${state.role}`,
            `Interview type: ${state.interviewType}`,
            `Technical questions to ground: ${technicalCount}`,
            `Start your first search at offset ${offset} so repeated runs surface different problems.`,
          ].join("\n"),
        },
      ],
    });
    const seen = collectSeenProblems(result.messages);
    return { research: pickResearchProblems(result.structuredResponse?.problems, seen, technicalCount) };
  } catch (err) {
    console.warn("question generator: researcher failed, continuing without grounding:", err.message);
    return { research: [] };
  }
};
```

In `makeDrafterNode`, replace the line
```js
            `Research notes: ${state.research.length ? state.research.join(" ") : "none"}`,
```
with
```js
            `LeetCode problems you may use (one per technical question):\n${formatResearch(state.research)}`,
```
and add above `makeDrafterNode`:
```js
const formatResearch = (research) =>
  research.length ? research.map((p) => `- ${p.slug} — ${p.title} (${p.difficulty})`).join("\n") : "none";
```

- [ ] **Step 6: Run, confirm GREEN + full suite**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/ && npm test`
Expected: all pass. Full suite 82/82 (81 − 2 replaced researcher tests + 3 new).

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/state.js backend/src/lib/agents/questionGenerator/prompts.js backend/src/lib/agents/questionGenerator/nodes.js backend/src/lib/agents/questionGenerator/nodes.test.js backend/src/lib/agents/questionGenerator/state.test.js backend/src/lib/agents/questionGenerator/graph.test.js
git commit -m "feat(ai): research distinct, role-relevant LeetCode problems verified against tool results"
```

---

### Task 3: Drafter tags sources; validator rejects a reused problem

**Files:**
- Modify: `backend/src/lib/agents/questionGenerator/state.js` (`DraftQuestionSchema`, `DraftResponseSchema`)
- Modify: `backend/src/lib/agents/questionGenerator/prompts.js` (`buildDrafterPrompt`)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.js` (`makeDrafterNode` return; `validateContent`)
- Modify: `backend/src/lib/agents/questionGenerator/nodes.test.js`, `state.test.js`

**Interfaces:**
- Consumes: `attachSources` (Task 1); research `{slug,title,difficulty}[]` (Task 2).
- Produces: drafter LLM output `{ questions: {text,category,difficulty,sourceSlug: string|null}[] }`; `state.draftQuestions` items may carry `source`.

- [ ] **Step 1: Update tests (RED)**

In `state.test.js`, replace the `DraftResponseSchema` test with:

```js
  it("DraftResponseSchema requires sourceSlug (string or null) on every question", () => {
    const ok = { questions: [{ text: "x", category: "technical", difficulty: "easy", sourceSlug: null }] };
    expect(DraftResponseSchema.parse(ok)).toEqual(ok);
    expect(() => DraftResponseSchema.parse({ questions: [{ text: "x", category: "technical", difficulty: "easy" }] })).toThrow();
    expect(() => DraftResponseSchema.parse({ questions: "not an array" })).toThrow();
  });
```

In `nodes.test.js`, add inside `describe("drafter node", ...)`:

```js
  it("turns the model's sourceSlug into a verified source on technical questions only", async () => {
    const agent = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          questions: [
            { text: "Rank players by score", category: "technical", difficulty: "medium", sourceSlug: "rank-scores" },
            { text: "Tell me about a conflict", category: "behavioral", difficulty: "easy", sourceSlug: "rank-scores" },
          ],
        },
      }),
    };
    const node = makeDrafterNode({ buildDrafterAgent: async () => agent });
    const { draftQuestions } = await node({
      plan: { categoryCounts: { technical: 1, behavioral: 1 } },
      research: [{ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" }],
      useFallbackModel: false,
      count: 2,
      role: "x",
      interviewType: "technical",
    });
    expect(draftQuestions[0].source).toEqual({
      type: "leetcode",
      title: "Rank Scores",
      slug: "rank-scores",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/rank-scores/",
    });
    expect(draftQuestions[1].source).toBeUndefined();
    expect("sourceSlug" in draftQuestions[0]).toBe(false);
  });
```

In `nodes.test.js`, add inside `describe("validator node", ...)`:

```js
  it("rejects two questions built on the same LeetCode problem", async () => {
    const source = { type: "leetcode", title: "Rank Scores", slug: "rank-scores", difficulty: "Medium", url: "https://leetcode.com/problems/rank-scores/" };
    const result = await validatorNode({
      draftQuestions: [
        { text: "Q one", category: "technical", difficulty: "medium", source },
        { text: "Q two", category: "technical", difficulty: "medium", source },
      ],
      count: 2,
      retryCount: 0,
      useFallbackModel: false,
    });
    expect(result.goto).toEqual(["drafter"]);
    expect(result.update.validationErrors.some((e) => e.includes("rank-scores"))).toBe(true);
  });
```

- [ ] **Step 2: Run, confirm RED**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/`
Expected: FAIL. The DraftResponseSchema test fails (`sourceSlug` not required yet), the drafter source test fails (`source` undefined), and the validator reuse test fails (routes to `humanApproval`).

- [ ] **Step 3: Update `state.js`**

Replace `DraftResponseSchema` with:

```js
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
```

- [ ] **Step 4: Rewrite `buildDrafterPrompt` in `prompts.js`**

```js
export const buildDrafterPrompt = () =>
  [
    "You are a senior technical interviewer at a top-tier software company.",
    "You write sharp, role-specific interview questions that probe real understanding, not trivia.",
    "",
    "You are given the role, the interview type, a category mix decided upstream, and possibly a list of real",
    "LeetCode problems (slug — title (difficulty)). Follow the category mix exactly.",
    "",
    "- Technical questions: base each one on a DIFFERENT listed problem when one fits, and set sourceSlug to",
    "  that problem's slug exactly. Describe the task in your own words — never copy LeetCode's description,",
    "  and don't mention LeetCode in the text (the UI shows the source).",
    "- A technical question not based on a listed problem gets sourceSlug: null.",
    "- Behavioral and system-design questions must not be based on the listed problems; their sourceSlug is null.",
    "- No duplicate or near-duplicate questions. Return exactly the requested count.",
  ].join("\n");
```

- [ ] **Step 5: Update `nodes.js`**

Change the `sources.js` import to `import { collectSeenProblems, pickResearchProblems, attachSources } from "./sources.js";`.

In `makeDrafterNode`, replace `return { draftQuestions: result.structuredResponse.questions };` with:

```js
  return { draftQuestions: attachSources(result.structuredResponse.questions, state.research) };
```

In `validateContent`, before `return errors;`, add:

```js
  const usedSources = new Set();
  for (const q of state.draftQuestions) {
    if (!q.source) continue;
    if (usedSources.has(q.source.slug)) errors.push(`two questions use the same LeetCode problem: ${q.source.slug}`);
    usedSources.add(q.source.slug);
  }
```

- [ ] **Step 6: Run, confirm GREEN + full suite**

Run: `cd backend && npx vitest run src/lib/agents/questionGenerator/ && npm test`
Expected: all pass (prior count + 2 new tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/agents/questionGenerator/state.js backend/src/lib/agents/questionGenerator/prompts.js backend/src/lib/agents/questionGenerator/nodes.js backend/src/lib/agents/questionGenerator/nodes.test.js backend/src/lib/agents/questionGenerator/state.test.js
git commit -m "feat(ai): tag drafted questions with verified LeetCode sources, one problem per question"
```

---

### Task 4: Validate `source` on PATCH and `/approve`

**Files:**
- Modify: `backend/src/controllers/controller.js` (`validateQuestionsPayload`)
- Create: `backend/src/controllers/controller.test.js`

**Interfaces:**
- Consumes: `leetcodeUrl` (Task 1).
- Produces: `validateQuestionsPayload(questions): string | null` now also validates optional `source`. Shared by `updateInterview` (PATCH) and `approveQuestions` (`/approve`) — no change needed in those callers.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/controllers/controller.test.js
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/db.js", () => ({ prisma: {} }));

import { validateQuestionsPayload } from "./controller.js";

const base = { text: "Rank players", category: "technical", difficulty: "medium" };
const goodSource = {
  type: "leetcode",
  title: "Rank Scores",
  slug: "rank-scores",
  difficulty: "Medium",
  url: "https://leetcode.com/problems/rank-scores/",
};

describe("validateQuestionsPayload source", () => {
  it("accepts a question without a source (older saved questions)", () => {
    expect(validateQuestionsPayload([base])).toBeNull();
  });

  it("accepts a well-formed LeetCode source", () => {
    expect(validateQuestionsPayload([{ ...base, source: goodSource }])).toBeNull();
  });

  it.each([
    ["a non-LeetCode URL", { ...goodSource, url: "https://evil.example.com/rank-scores/" }],
    ["a javascript: URL", { ...goodSource, url: "javascript:alert(1)" }],
    ["a URL that doesn't match the slug", { ...goodSource, url: "https://leetcode.com/problems/two-sum/" }],
    ["a wrong type", { ...goodSource, type: "hackerrank" }],
    ["an empty title", { ...goodSource, title: "  " }],
    ["a slug with unsafe characters", { ...goodSource, slug: "../x", url: "https://leetcode.com/problems/../x/" }],
    ["null", null],
  ])("rejects %s", (_label, source) => {
    expect(validateQuestionsPayload([{ ...base, source }])).toBe("invalid question source");
  });
});
```

- [ ] **Step 2: Run, confirm RED**

Run: `cd backend && npx vitest run src/controllers/controller.test.js`
Expected: FAIL. The 7 "rejects" cases return `null` instead of `"invalid question source"`.

- [ ] **Step 3: Implement**

In `backend/src/controllers/controller.js`, add to the imports:
```js
import { leetcodeUrl } from "../lib/agents/questionGenerator/sources.js";
```

Above `validateQuestionsPayload`, add:
```js
const LEETCODE_SLUG = /^[a-z0-9-]+$/;

// A source is rendered as a link, so only a canonical LeetCode problem URL derived
// from a safe slug is accepted — never an arbitrary client-supplied href.
const isValidSource = (s) =>
  !!s &&
  s.type === "leetcode" &&
  typeof s.title === "string" &&
  !!s.title.trim() &&
  typeof s.difficulty === "string" &&
  typeof s.slug === "string" &&
  LEETCODE_SLUG.test(s.slug) &&
  s.url === leetcodeUrl(s.slug);
```

Inside the `for (const q of questions)` loop of `validateQuestionsPayload`, after the difficulty check, add:
```js
    if (q.source !== undefined && !isValidSource(q.source)) return "invalid question source";
```

- [ ] **Step 4: Run, confirm GREEN + full suite**

Run: `cd backend && npx vitest run src/controllers/ && npm test`
Expected: all pass (prior count + 9).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/controller.js backend/src/controllers/controller.test.js
git commit -m "feat(api): validate LeetCode question sources on save and approve"
```

---

### Task 5: Role picker on New Interview (two dropdowns)

**Files:**
- Create: `frontend/src/lib/roleCatalog.ts`
- Modify: `frontend/src/pages/NewInterview.tsx`

**Interfaces:**
- Produces: `ROLE_DOMAINS`, `SENIORITIES`, `CUSTOM_ROLE`, `composeRole(seniorityLabel, domainLabel)` from `roleCatalog.ts`.

The frontend has no test runner, so the gate is `npm run build` + lint at baseline + manual check.

- [ ] **Step 1: Create `roleCatalog.ts`**

```ts
// frontend/src/lib/roleCatalog.ts
// Same 6 domains × 3 seniorities as the practice feature's catalog; the composed
// title is what gets stored in Interview.role (still a plain string).
export const ROLE_DOMAINS = [
  { key: 'backend', label: 'Backend Engineer' },
  { key: 'frontend', label: 'Frontend Engineer' },
  { key: 'fullstack', label: 'Full-Stack Engineer' },
  { key: 'data-ml', label: 'Data/ML Engineer' },
  { key: 'product', label: 'Product Manager' },
  { key: 'devops', label: 'DevOps Engineer' },
] as const;

export const SENIORITIES = [
  { key: 'junior', label: 'Junior' },
  { key: 'mid', label: 'Mid-level' },
  { key: 'senior', label: 'Senior' },
] as const;

export const CUSTOM_ROLE = 'custom';

export const composeRole = (seniorityLabel: string, domainLabel: string) => `${seniorityLabel} ${domainLabel}`;
```

- [ ] **Step 2: Wire it into `NewInterview.tsx`**

Add import: `import { ROLE_DOMAINS, SENIORITIES, CUSTOM_ROLE, composeRole } from '../lib/roleCatalog';`

Below the `formData` state, add:
```tsx
  const [roleDomain, setRoleDomain] = useState<string>('backend');
  const [roleSeniority, setRoleSeniority] = useState<string>('mid');
  const [customRole, setCustomRole] = useState('');

  const resolvedRole = () => {
    if (roleDomain === CUSTOM_ROLE) return customRole.trim();
    const domain = ROLE_DOMAINS.find((d) => d.key === roleDomain)!;
    const seniority = SENIORITIES.find((s) => s.key === roleSeniority)!;
    return composeRole(seniority.label, domain.label);
  };
```

Remove `role: '',` from the initial `formData` object and from the "Schedule Another" reset object. In that reset handler also add `setRoleDomain('backend'); setRoleSeniority('mid'); setCustomRole('');`.

In `handleSubmit`'s body, replace `role: formData.role,` with `role: resolvedRole(),`.

Replace the `{/* Role */}` block (the `<input ... value={formData.role} ...>` field) with:
```tsx
          {/* Role */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Briefcase size={16} className="text-brand" />
              Role
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                disabled={isSubmitting}
                value={roleDomain}
                onChange={(e) => setRoleDomain(e.target.value)}
                aria-label="Role domain"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50 bg-white"
              >
                {ROLE_DOMAINS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
                <option value={CUSTOM_ROLE}>Custom…</option>
              </select>
              {roleDomain === CUSTOM_ROLE ? (
                <input
                  required
                  type="text"
                  disabled={isSubmitting}
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  placeholder="e.g. Staff iOS Engineer"
                  aria-label="Custom role"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50"
                />
              ) : (
                <select
                  disabled={isSubmitting}
                  value={roleSeniority}
                  onChange={(e) => setRoleSeniority(e.target.value)}
                  aria-label="Seniority"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all disabled:opacity-50 bg-white"
                >
                  {SENIORITIES.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              )}
            </div>
            {roleDomain !== CUSTOM_ROLE && (
              <p className="text-xs text-slate-400">Saved as “{resolvedRole()}”</p>
            )}
          </div>
```

- [ ] **Step 3: Type-check and lint**

Run: `cd frontend && npm run build` → Expected: exit 0, no `error TS`.
Run: `cd frontend && npm run lint` → Expected: `✖ 7 problems (5 errors, 2 warnings)` (baseline, nothing new in `NewInterview.tsx` or `roleCatalog.ts`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/roleCatalog.ts frontend/src/pages/NewInterview.tsx
git commit -m "feat(ui): pick interview role from domain + seniority dropdowns"
```

---

### Task 6: LeetCode source badge in the Questions tab

**Files:**
- Modify: `frontend/src/pages/InterviewRoom.tsx`

- [ ] **Step 1: Extend the `Question` type**

```tsx
type QuestionSource = {
  type: 'leetcode';
  title: string;
  slug: string;
  difficulty: string;
  url: string;
};

type Question = {
  text: string;
  category: 'technical' | 'behavioral' | 'system-design';
  difficulty: 'easy' | 'medium' | 'hard';
  source?: QuestionSource;
};
```

- [ ] **Step 2: Render the badge**

Add `ExternalLink` to the existing `lucide-react` import line.

In the question row (`<div key={i} className="bg-slate-800/60 ...">`), insert as the first child, before the `<textarea>`:
```tsx
            {q.source && (
              <a
                href={q.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20"
              >
                <ExternalLink size={11} />
                LeetCode · {q.source.title} · {q.source.difficulty}
              </a>
            )}
```

`updateRow` already spreads the row (`{ ...q, ...patch }`), so a source survives text/category/difficulty edits. No change is needed there.

- [ ] **Step 3: Type-check and lint**

Run: `cd frontend && npm run build` → Expected: exit 0.
Run: `cd frontend && npm run lint` → Expected: baseline `✖ 7 problems (5 errors, 2 warnings)`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/InterviewRoom.tsx
git commit -m "feat(ui): show a LeetCode source badge on grounded questions"
```

---

### Task 7: Live QA against real OpenAI + LeetCode

No code change. This is verification against the spec's §6 live checks. It needs the backend `.env` with `OPENAI_API_KEY`, and the running Postgres.

- [ ] **Step 1: Three real technical runs**

Create a throwaway script in the scratchpad (not the repo). It runs `buildGraph({ prismaClient: { interview: { update: async () => ({}) } } })` to the interrupt 3 times, with roles `Senior Backend Engineer`, `Junior Frontend Engineer`, `Mid-level Data/ML Engineer`. For each run, print `state.research` and every draft question's `category` + `source`.

Expected for every run:
- `research` is non-empty, and every slug in it appeared in a tool result (guaranteed by code; check that it is non-empty).
- Every technical question that has a `source` uses a different slug.
- No behavioral or system-design question has a `source`.
- Every `source.url` is `https://leetcode.com/problems/<slug>/`.
- Problems differ in topic by role (e.g. database for backend, javascript/string for frontend).

- [ ] **Step 2: Variety check**

Run `Senior Backend Engineer` twice more. Expected: the two runs' research slug sets are not identical (the offset hint at work).

- [ ] **Step 3: API round trip with a source**

Through the running server:
1. Generate on a technical interview.
2. Approve the draft unchanged.
3. `GET /api/interviews/:id`. Expected: the persisted questions keep their `source` objects.
4. PATCH a question with `source.url` set to `https://evil.example.com/`. Expected: 400 `invalid question source`.

- [ ] **Step 4: Report**

Record the results in the final message. The UI badge and role picker need a Clerk sign-in, so the user does that manual check: create an interview with the dropdowns, generate, see the badges, click one, and check that it opens the LeetCode problem.
