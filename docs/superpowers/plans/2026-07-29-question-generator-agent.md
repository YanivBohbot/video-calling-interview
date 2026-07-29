# Personalized Question-Generator Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the never-implemented single-shot question generator with a LangChain tool-calling agent that infers seniority/domain from the interview's `role` text, optionally grounds technical questions in real LeetCode problems (via an MCP tool it chooses to call or not), and produces 5–8 structured questions the interviewer can edit and save.

**Architecture:** `backend/src/lib/agents/leetcodeMcpClient.js` is a singleton wrapper around `@langchain/mcp-adapters`'s `MultiServerMCPClient`, connecting once (stdio) to the `@jinzcdev/leetcode-mcp-server` npm package and exposing an allowlisted subset of its tools (`get_daily_challenge`, `get_problem`, `search_problems`) — or an empty list if the connection fails, so the rest of the app degrades gracefully. `backend/src/lib/agents/questionGeneratorAgent.js` builds a LangChain `createAgent` with those tools and a Zod `responseFormat`, so the agent's output is validated by the framework itself rather than hand-parsed JSON. The existing `POST /api/interviews/:id/questions/generate` route (never wired) now calls this agent; the existing `PATCH /api/interviews/:id` gains support for saving the `questions` field (the column already exists from the prior sub-project). Frontend gets a third "Questions" tab in `InterviewRoom.tsx` alongside the existing Code/System-Design tabs.

**Tech Stack:** Express 5 (ESM) + Prisma 6 (PostgreSQL) backend, React 19 + Vite + TypeScript frontend, `langchain` 1.0 (`createAgent`), `@langchain/openai`, `@langchain/mcp-adapters` (`MultiServerMCPClient`), `zod`, Vitest (already set up in the backend from the prior sub-project).

**Spec:** `docs/superpowers/specs/2026-07-29-question-generator-agent-design.md`

## Global Constraints

- Reuses `Interview.questions Json?` (already exists — migration `add_code_and_questions` from the prior sub-project, already applied and merged). No new migration in this plan.
- The agent decides for itself whether to call the LeetCode tool — no code branches on `interviewType` to gate tool availability.
- Only three LeetCode MCP tools are ever exposed to the agent: `get_daily_challenge`, `get_problem`, `search_problems`. Never pass through the server's user-profile/submission/auth-required tools.
- If the LeetCode MCP connection fails for any reason, the agent must still run (with `tools: []`) — never let that failure surface as an error to the user.
- `systemPrompt` and `responseFormat` are the current `createAgent` field names (verified against live LangChain.js docs — `prompt` was renamed to `systemPrompt` in v1; `result.structuredResponse` is the current result field, not `result.content`).
- Rate limit: 10 generations per rolling hour per `clerkId`, in-memory (same pattern as the never-implemented prior spec).
- Node.js 20+ required for LangChain 1.0 — this repo runs Node 24, no action needed.

---

### Task 1: Install LangChain dependencies and document config

**Files:**
- Modify: `backend/package.json`
- Create: `backend/.env.example`

**Interfaces:**
- Produces: `langchain`, `@langchain/core`, `@langchain/openai`, `@langchain/mcp-adapters`, `zod` available as backend dependencies for every later task.

- [ ] **Step 1: Install dependencies**

Run from `backend/`:
```bash
npm install langchain@^1.0.0 @langchain/core@^1.0.0 @langchain/openai@^1.0.0 @langchain/mcp-adapters@latest zod@^3.23.0
```

- [ ] **Step 2: Create `backend/.env.example`**

No `.env.example` exists yet in this repo. Create one documenting the vars this feature needs (existing `.env` vars are left alone — this file only needs to cover what a new developer setting up this feature needs):

```
# AI question generator (sub-project: question-generator-agent)
OPENAI_API_KEY=
AI_MODEL=gpt-4o-mini
AI_QUESTION_COUNT=6
```

- [ ] **Step 3: Verify install**

Run from `backend/`: `node -e "import('langchain').then(() => console.log('ok'))"`
Expected: prints `ok`, no import errors.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/.env.example
git commit -m "chore(ai): add LangChain, OpenAI provider, and MCP adapter dependencies"
```

---

### Task 2: Rate limiter (TDD)

**Files:**
- Create: `backend/src/lib/rateLimiter.test.js`
- Create: `backend/src/lib/rateLimiter.js`

**Interfaces:**
- Produces: `createRateLimiter({ max, windowMs }) → { check(key: string): { ok: true } | { ok: false, retryAfter: number } }`, used by Task 6 (the AI controller).

- [ ] **Step 1: Write the failing tests**

`backend/src/lib/rateLimiter.test.js`:
```js
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRateLimiter } from "./rateLimiter.js";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("allows up to `max` calls within the window", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });
    expect(limiter.check("user-a")).toEqual({ ok: true });
    expect(limiter.check("user-a")).toEqual({ ok: true });
    expect(limiter.check("user-a")).toEqual({ ok: true });
  });

  it("rejects the (max+1)th call with retryAfter seconds", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    limiter.check("user-a");
    limiter.check("user-a");
    const result = limiter.check("user-a");
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it("isolates buckets by key", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.check("user-a").ok).toBe(true);
    expect(limiter.check("user-b").ok).toBe(true);
    expect(limiter.check("user-a").ok).toBe(false);
  });

  it("allows again after the window passes", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.check("user-a").ok).toBe(true);
    expect(limiter.check("user-a").ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(limiter.check("user-a").ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run from `backend/`: `npm test -- rateLimiter`
Expected: FAIL — `Cannot find module './rateLimiter.js'`.

- [ ] **Step 3: Implement `backend/src/lib/rateLimiter.js`**

```js
// In-memory sliding-window limiter keyed by an arbitrary string (e.g. clerkId).
// Process-local — fine for a single-instance deployment.
export const createRateLimiter = ({ max, windowMs }) => {
  const hits = new Map(); // key -> number[] (timestamps ms)

  const check = (key) => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = (hits.get(key) || []).filter((t) => t > cutoff);

    if (arr.length >= max) {
      const oldest = arr[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      hits.set(key, arr);
      return { ok: false, retryAfter };
    }

    arr.push(now);
    hits.set(key, arr);
    return { ok: true };
  };

  return { check };
};
```

- [ ] **Step 4: Run and verify it passes**

Run from `backend/`: `npm test -- rateLimiter`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/rateLimiter.js backend/src/lib/rateLimiter.test.js
git commit -m "feat(ai): in-memory per-key rate limiter"
```

---

### Task 3: LeetCode MCP client wrapper (TDD)

**Files:**
- Create: `backend/src/lib/agents/leetcodeMcpClient.test.js`
- Create: `backend/src/lib/agents/leetcodeMcpClient.js`

**Interfaces:**
- Produces: `getLeetCodeTools({ client } = {}): Promise<StructuredTool[]>` and `_resetLeetCodeToolsCache(): void` — both used by Task 5 (`questionGeneratorAgent.js`) and by this task's own tests. `client` is an optional injected override (a `MultiServerMCPClient`-shaped object with a `getTools()` method) so tests never spawn the real subprocess.

- [ ] **Step 1: Write the failing tests**

`backend/src/lib/agents/leetcodeMcpClient.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLeetCodeTools, _resetLeetCodeToolsCache } from "./leetcodeMcpClient.js";

const makeMockClient = (tools) => ({
  getTools: vi.fn().mockResolvedValue(tools),
});

const makeFailingClient = (message) => ({
  getTools: vi.fn().mockRejectedValue(new Error(message)),
});

describe("getLeetCodeTools", () => {
  beforeEach(() => {
    _resetLeetCodeToolsCache();
  });

  it("filters the server's tools down to the allowlist", async () => {
    const client = makeMockClient([
      { name: "get_daily_challenge" },
      { name: "search_problems" },
      { name: "get_problem" },
      { name: "get_user_profile" }, // not allowlisted — requires nothing we want to expose
      { name: "get_all_submissions" }, // not allowlisted — auth-required
    ]);

    const tools = await getLeetCodeTools({ client });

    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_daily_challenge",
      "get_problem",
      "search_problems",
    ]);
  });

  it("returns an empty array without throwing when the connection fails", async () => {
    const client = makeFailingClient("spawn ENOENT");
    await expect(getLeetCodeTools({ client })).resolves.toEqual([]);
  });

  it("memoizes the result — only fetches tools once across multiple calls", async () => {
    const client = makeMockClient([{ name: "search_problems" }]);

    await getLeetCodeTools({ client });
    await getLeetCodeTools({ client });

    expect(client.getTools).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run from `backend/`: `npm test -- leetcodeMcpClient`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `backend/src/lib/agents/leetcodeMcpClient.js`**

```js
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const ALLOWED_TOOL_NAMES = new Set(["get_daily_challenge", "get_problem", "search_problems"]);

const buildDefaultClient = () =>
  new MultiServerMCPClient({
    leetcode: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@jinzcdev/leetcode-mcp-server", "--site", "global"],
    },
  });

let cachedToolsPromise = null;

export const getLeetCodeTools = async ({ client } = {}) => {
  if (cachedToolsPromise) return cachedToolsPromise;

  cachedToolsPromise = (async () => {
    try {
      const mcpClient = client || buildDefaultClient();
      const tools = await mcpClient.getTools();
      return tools.filter((t) => ALLOWED_TOOL_NAMES.has(t.name));
    } catch (err) {
      console.error(
        "leetcodeMcpClient: failed to connect, continuing without LeetCode tools:",
        err.message,
      );
      return [];
    }
  })();

  return cachedToolsPromise;
};

// Test-only: clears the memoized connection so each test starts fresh.
export const _resetLeetCodeToolsCache = () => {
  cachedToolsPromise = null;
};
```

- [ ] **Step 4: Run and verify it passes**

Run from `backend/`: `npm test -- leetcodeMcpClient`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/agents/leetcodeMcpClient.js backend/src/lib/agents/leetcodeMcpClient.test.js
git commit -m "feat(ai): LeetCode MCP client wrapper with tool allowlist and graceful fallback"
```

---

### Task 4: Prompt template

**Files:**
- Create: `backend/src/lib/agents/prompts/questionGenerator.js`

- [ ] **Step 1: Write `backend/src/lib/agents/prompts/questionGenerator.js`**

```js
// System prompt for the question-generator agent. Kept in its own file so it
// can be iterated without touching the agent/tool-wiring code.
export const buildQuestionGeneratorPrompt = () =>
  [
    "You are a senior technical interviewer at a top-tier software company.",
    "You write sharp, role-specific interview questions that probe real understanding, not trivia.",
    "",
    "Before writing questions, infer from the given role text:",
    "- Seniority level (junior, mid-level, senior, staff/principal) — bias question difficulty accordingly:",
    "  junior skews easy, mid skews easy/medium, senior skews medium/hard, staff+ skews hard.",
    "- Domain (backend, frontend, full-stack, data, mobile, devops, etc.) — steer topic relevance to that domain.",
    "",
    "You have access to LeetCode problem-search tools. For interviews where a concrete coding problem",
    "would help (typically technical rounds), you may call search_problems or get_problem to ground",
    "one or more questions in a real, well-known problem, filtered by difficulty and relevant tags.",
    "This is entirely your judgment call — not every interview needs it, and behavioral or system-design",
    "rounds typically won't.",
    "",
    "IMPORTANT: LeetCode's problem descriptions are copyrighted. If you use a tool result, do not copy",
    "its description verbatim. Name the problem and topic, then describe the task in your own words.",
    "",
    "Mix difficulties and categories appropriately for the requested interview type:",
    "- For a 'technical' interview, lean technical with one or two behavioral.",
    "- For a 'behavioral' interview, lean behavioral; technical questions should still be role-relevant.",
    "- For a 'system-design' interview, lean system-design.",
    "- No duplicate or near-duplicate questions.",
  ].join("\n");
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/lib/agents/prompts/questionGenerator.js
git commit -m "feat(ai): add question-generator system prompt"
```

---

### Task 5: Question-generator agent (TDD)

**Files:**
- Create: `backend/src/lib/agents/questionGeneratorAgent.test.js`
- Create: `backend/src/lib/agents/questionGeneratorAgent.js`

**Interfaces:**
- Consumes: `getLeetCodeTools` (Task 3), `buildQuestionGeneratorPrompt` (Task 4).
- Produces: `generateInterviewQuestions({ role, interviewType, count }, { agent } = {}) → Promise<Question[]>` and error classes `AIConfigError`, `AIProviderError`, `AIInvalidResponseError` — all used by Task 6 (the controller). `agent` is an optional injected override (an object with an `invoke()` method matching `createAgent`'s return shape) so tests never call the real OpenAI API or build a real agent.

- [ ] **Step 1: Write the failing tests**

`backend/src/lib/agents/questionGeneratorAgent.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const validQuestions = [
  { text: "Explain how you'd design a rate limiter.", category: "system-design", difficulty: "medium" },
  { text: "Tell me about a time you disagreed with a teammate.", category: "behavioral", difficulty: "easy" },
];

const makeMockAgent = (structuredResponse) => ({
  invoke: vi.fn().mockResolvedValue({ structuredResponse }),
});

describe("generateInterviewQuestions", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.AI_MODEL = "gpt-4o-mini";
  });

  it("returns the validated questions array on a valid response", async () => {
    const agent = makeMockAgent({ questions: validQuestions });
    const { generateInterviewQuestions } = await import("./questionGeneratorAgent.js");

    const result = await generateInterviewQuestions(
      { role: "Senior Backend Engineer", interviewType: "technical", count: 2 },
      { agent },
    );

    expect(result).toEqual(validQuestions);
    expect(agent.invoke).toHaveBeenCalledOnce();
    const [messagesArg, configArg] = agent.invoke.mock.calls[0];
    expect(messagesArg.messages[0].content).toContain("Senior Backend Engineer");
    expect(configArg).toEqual({ recursionLimit: 10 });
  });

  it("throws AIInvalidResponseError when the questions array is empty", async () => {
    const agent = makeMockAgent({ questions: [] });
    const { generateInterviewQuestions, AIInvalidResponseError } = await import(
      "./questionGeneratorAgent.js"
    );

    await expect(
      generateInterviewQuestions({ role: "x", interviewType: "technical", count: 1 }, { agent }),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });

  it("throws AIInvalidResponseError when a question is missing text", async () => {
    const agent = makeMockAgent({ questions: [{ text: "", category: "technical", difficulty: "easy" }] });
    const { generateInterviewQuestions, AIInvalidResponseError } = await import(
      "./questionGeneratorAgent.js"
    );

    await expect(
      generateInterviewQuestions({ role: "x", interviewType: "technical", count: 1 }, { agent }),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });

  it("throws AIProviderError when agent.invoke rejects", async () => {
    const agent = { invoke: vi.fn().mockRejectedValue(new Error("boom")) };
    const { generateInterviewQuestions, AIProviderError } = await import("./questionGeneratorAgent.js");

    await expect(
      generateInterviewQuestions({ role: "x", interviewType: "technical", count: 1 }, { agent }),
    ).rejects.toBeInstanceOf(AIProviderError);
  });

  it("throws AIConfigError when OPENAI_API_KEY is missing and no agent override is given", async () => {
    delete process.env.OPENAI_API_KEY;
    const { generateInterviewQuestions, AIConfigError } = await import("./questionGeneratorAgent.js");

    await expect(
      generateInterviewQuestions({ role: "x", interviewType: "technical", count: 1 }),
    ).rejects.toBeInstanceOf(AIConfigError);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run from `backend/`: `npm test -- questionGeneratorAgent`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `backend/src/lib/agents/questionGeneratorAgent.js`**

```js
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
```

- [ ] **Step 4: Run and verify it passes**

Run from `backend/`: `npm test -- questionGeneratorAgent`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/agents/questionGeneratorAgent.js backend/src/lib/agents/questionGeneratorAgent.test.js
git commit -m "feat(ai): question-generator agent with LeetCode tool and structured output"
```

---

### Task 6: AI controller (TDD)

**Files:**
- Create: `backend/src/controllers/aiController.test.js`
- Create: `backend/src/controllers/aiController.js`

**Interfaces:**
- Consumes: `generateInterviewQuestions`, `AIProviderError`, `AIInvalidResponseError`, `AIConfigError` (Task 5), `createRateLimiter` (Task 2), `prisma` (`backend/src/lib/db.js`).
- Produces: `generateQuestions(req, res)` Express handler, used by Task 7 (route wiring).

- [ ] **Step 1: Write the failing test**

`backend/src/controllers/aiController.test.js`:
```js
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
```

- [ ] **Step 2: Run and verify it fails**

Run from `backend/`: `npm test -- aiController`
Expected: FAIL — `aiController.js` not found.

- [ ] **Step 3: Implement `backend/src/controllers/aiController.js`**

```js
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
```

- [ ] **Step 4: Run and verify all pass**

Run from `backend/`: `npm test`
Expected: all suites (rateLimiter, leetcodeMcpClient, questionGeneratorAgent, aiController) pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/aiController.js backend/src/controllers/aiController.test.js
git commit -m "feat(ai): controller for POST /interviews/:id/questions/generate"
```

---

### Task 7: Wire the route

**Files:**
- Modify: `backend/src/routes/interview.routes.js`

- [ ] **Step 1: Add the AI generate route with auth**

`backend/src/routes/interview.routes.js` currently reads:
```js
import express from "express";
import controller from "../controllers/controller.js";

const router = express.Router();

// Aggregate routes — must be declared before /:id to avoid shadowing
router.get("/stats", controller.getInterviewStats);
router.get("/activity", controller.getRecentActivity);

// List interviews (optionally filtered by x-clerk-id header or ?interviewerId=)
router.get("/", controller.listInterviews);

// Create a new interview
router.post("/", controller.createInterview);

// Get single interview
router.get("/:id", controller.getInterview);

// Update interview status
router.patch("/:id/status", controller.updateInterviewStatus);

// Update interview notes / status (compte rendu)
router.patch("/:id", controller.updateInterview);

// Delete interview
router.delete("/:id", controller.deleteInterview);

export default router;
```

Replace it with:
```js
import express from "express";
import controller from "../controllers/controller.js";
import aiController from "../controllers/aiController.js";
import { protectRoute } from "../middlewares/protectRoute.js";

const router = express.Router();

// Aggregate routes — must be declared before /:id to avoid shadowing
router.get("/stats", controller.getInterviewStats);
router.get("/activity", controller.getRecentActivity);

// List interviews (optionally filtered by x-clerk-id header or ?interviewerId=)
router.get("/", controller.listInterviews);

// Create a new interview
router.post("/", controller.createInterview);

// AI: generate questions for an interview (must come before generic /:id routes)
router.post("/:id/questions/generate", protectRoute, aiController.generateQuestions);

// Get single interview
router.get("/:id", controller.getInterview);

// Update interview status
router.patch("/:id/status", controller.updateInterviewStatus);

// Update interview notes / status (compte rendu)
router.patch("/:id", controller.updateInterview);

// Delete interview
router.delete("/:id", controller.deleteInterview);

export default router;
```

- [ ] **Step 2: Manual sanity check — server boots**

Run from `backend/`: `npm run dev`
Expected: server boots without errors. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/interview.routes.js
git commit -m "feat(ai): wire POST /interviews/:id/questions/generate route"
```

---

### Task 8: Extend `updateInterview` to accept `questions`

**Files:**
- Modify: `backend/src/controllers/controller.js`

- [ ] **Step 1: Update `updateInterview` (currently at line 174)**

Current code:
```js
export const updateInterview = async (req, res) => {
  try {
    const { notes, status } = req.body;
    const data = {};
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) {
      const allowed = ["scheduled", "live", "completed", "cancelled"];
      if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });
      data.status = status;
    }
    const updated = await prisma.interview.update({
      where: { id: req.params.id },
      data,
      include: { interviewer: { select: INTERVIEWER_SELECT } },
    });
    return res.status(200).json(toInterviewDoc(updated));
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Interview not found" });
    return res.status(500).json({ message: "Error updating interview", error: error.message });
  }
};
```

Replace with:
```js
const ALLOWED_QUESTION_CATEGORY = new Set(["technical", "behavioral", "system-design"]);
const ALLOWED_QUESTION_DIFFICULTY = new Set(["easy", "medium", "hard"]);

const validateQuestionsPayload = (questions) => {
  if (!Array.isArray(questions)) return "questions must be an array";
  for (const q of questions) {
    if (typeof q?.text !== "string" || !q.text.trim()) return "each question needs non-empty text";
    if (!ALLOWED_QUESTION_CATEGORY.has(q.category)) return `invalid category: ${q.category}`;
    if (!ALLOWED_QUESTION_DIFFICULTY.has(q.difficulty)) return `invalid difficulty: ${q.difficulty}`;
  }
  return null;
};

export const updateInterview = async (req, res) => {
  try {
    const { notes, status, questions } = req.body;
    const data = {};
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) {
      const allowed = ["scheduled", "live", "completed", "cancelled"];
      if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });
      data.status = status;
    }
    if (questions !== undefined) {
      const err = validateQuestionsPayload(questions);
      if (err) return res.status(400).json({ message: err });
      data.questions = questions;
    }
    const updated = await prisma.interview.update({
      where: { id: req.params.id },
      data,
      include: { interviewer: { select: INTERVIEWER_SELECT } },
    });
    return res.status(200).json(toInterviewDoc(updated));
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Interview not found" });
    return res.status(500).json({ message: "Error updating interview", error: error.message });
  }
};
```

Place `ALLOWED_QUESTION_CATEGORY`, `ALLOWED_QUESTION_DIFFICULTY`, and `validateQuestionsPayload` directly above `updateInterview` (they're declared inline in the replacement above — just make sure they land before the function that uses them, since this file uses top-level `const` declarations, not hoisted `function` declarations).

- [ ] **Step 2: Manual verification — PATCH with valid and invalid questions**

Start the server (`npm run dev`), then in another shell (replace `<id>` with a real interview id from `npx prisma studio` or the app):
```bash
curl -X PATCH http://localhost:3001/api/interviews/<id> \
  -H "Content-Type: application/json" \
  -H "x-clerk-id: demo" \
  -d '{"questions":[{"text":"Test Q","category":"technical","difficulty":"easy"}]}'
```
Expected: 200, response includes `"questions":[{"text":"Test Q",...}]`.

Then:
```bash
curl -X PATCH http://localhost:3001/api/interviews/<id> \
  -H "Content-Type: application/json" \
  -H "x-clerk-id: demo" \
  -d '{"questions":[{"text":"","category":"foo","difficulty":"bar"}]}'
```
Expected: 400.

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/controller.js
git commit -m "feat(api): allow saving questions array via PATCH /interviews/:id"
```

---

### Task 9: Frontend — Questions tab on `InterviewRoom`

**Files:**
- Modify: `frontend/src/pages/InterviewRoom.tsx`

**Interfaces:**
- Consumes: `POST /interviews/:id/questions/generate` (Task 7), `PATCH /interviews/:id` with `questions` (Task 8).

- [ ] **Step 1: Add a shared `Question` type and extend `interviewData`'s type**

`frontend/src/pages/InterviewRoom.tsx:12` currently imports icons:
```tsx
import { Video, Code, PenTool, FileText, Loader2, Save } from 'lucide-react';
```
Change to add `Sparkles`:
```tsx
import { Video, Code, PenTool, FileText, Loader2, Save, Sparkles } from 'lucide-react';
```

Then, right after that import block (before the `ReportModal` component, around line 18), add the shared type:
```tsx
type Question = {
  text: string;
  category: 'technical' | 'behavioral' | 'system-design';
  difficulty: 'easy' | 'medium' | 'hard';
};
```

Then update the `interviewData` state type at lines 100-103, currently:
```tsx
  const [interviewData, setInterviewData] = React.useState<{
    codeSnapshot?: string | null;
    codeLanguage?: string | null;
  } | null>(null);
```
to:
```tsx
  const [interviewData, setInterviewData] = React.useState<{
    codeSnapshot?: string | null;
    codeLanguage?: string | null;
    questions?: Question[] | null;
  } | null>(null);
```

No change needed to the fetch effect itself (lines 148-165) — it already fetches the whole interview record via `GET /api/interviews/:id`, which will include `questions` automatically once Task 8 lands (same `toInterviewDoc` spread behavior already relied on for `codeSnapshot`/`codeLanguage`).

- [ ] **Step 2: Add the `QuestionsPanel` component**

Add this component after `ReportModal` and before `export const InterviewRoom`:
```tsx
const API = 'http://localhost:3001/api';

const QuestionsPanel: React.FC<{
  interviewId: string;
  clerkId: string;
  initialQuestions?: Question[] | null;
}> = ({ interviewId, clerkId, initialQuestions }) => {
  const [questions, setQuestions] = React.useState<Question[]>(initialQuestions ?? []);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/interviews/${interviewId}/questions/generate`, {
        method: 'POST',
        headers: { 'x-clerk-id': clerkId },
      });
      const body = await r.json();
      if (!r.ok) {
        setError(
          r.status === 429
            ? `Slow down — try again in ${body.retryAfter}s`
            : body?.message || 'Failed to generate questions',
        );
        return;
      }
      setQuestions(body.questions);
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (i: number, patch: Partial<Question>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));

  const deleteRow = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API}/interviews/${interviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-clerk-id': clerkId },
        body: JSON.stringify({ questions }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body?.message || 'Failed to save questions');
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-900/60 rounded-2xl border border-white/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-brand" />
          <h3 className="text-white font-semibold">Interview questions</h3>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          {questions.length ? 'Regenerate' : 'Generate questions'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 text-sm rounded-lg p-3 mb-3">
          {error}
        </div>
      )}

      {questions.length === 0 && !loading && (
        <p className="text-slate-400 text-sm">No questions yet — click "Generate questions".</p>
      )}

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={i} className="bg-slate-800/60 border border-white/5 rounded-xl p-3 flex flex-col gap-2">
            <textarea
              value={q.text}
              onChange={(e) => updateRow(i, { text: e.target.value })}
              rows={2}
              className="w-full bg-transparent text-slate-100 text-sm resize-none focus:outline-none"
            />
            <div className="flex items-center gap-2 text-xs">
              <select
                value={q.category}
                onChange={(e) => updateRow(i, { category: e.target.value as Question['category'] })}
                className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-slate-200"
              >
                <option value="technical">technical</option>
                <option value="behavioral">behavioral</option>
                <option value="system-design">system-design</option>
              </select>
              <select
                value={q.difficulty}
                onChange={(e) => updateRow(i, { difficulty: e.target.value as Question['difficulty'] })}
                className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-slate-200"
              >
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </select>
              <button onClick={() => deleteRow(i)} className="ml-auto text-slate-500 hover:text-red-400">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {questions.length > 0 && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save questions
          </button>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Add the third tab**

`frontend/src/pages/InterviewRoom.tsx:98` currently:
```tsx
  const [activeTab, setActiveTab] = React.useState<'code' | 'design'>('code');
```
Change to:
```tsx
  const [activeTab, setActiveTab] = React.useState<'code' | 'design' | 'questions'>('code');
```

The tab-selector JSX at lines 233-252 currently ends with the "System Design" button closing at line 251-252:
```tsx
                  <button
                    onClick={() => setActiveTab('design')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'design' ? 'bg-brand text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <PenTool size={16} />
                    System Design
                  </button>
                </div>
```
Add a third button right after the "System Design" button, before the closing `</div>`:
```tsx
                  <button
                    onClick={() => setActiveTab('design')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'design' ? 'bg-brand text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <PenTool size={16} />
                    System Design
                  </button>
                  <button
                    onClick={() => setActiveTab('questions')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === 'questions' ? 'bg-brand text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <Sparkles size={16} />
                    Questions
                  </button>
                </div>
```

- [ ] **Step 4: Render the panel**

Lines 256-264 currently:
```tsx
                  {activeTab === 'code' ? (
                    <CollaborativeEditor
                      roomId={id || 'default'}
                      initialCode={interviewData?.codeSnapshot ?? undefined}
                      initialLanguage={interviewData?.codeLanguage ?? undefined}
                    />
                  ) : (
                    <Whiteboard />
                  )}
```
Change to:
```tsx
                  {activeTab === 'code' ? (
                    <CollaborativeEditor
                      roomId={id || 'default'}
                      initialCode={interviewData?.codeSnapshot ?? undefined}
                      initialLanguage={interviewData?.codeLanguage ?? undefined}
                    />
                  ) : activeTab === 'design' ? (
                    <Whiteboard />
                  ) : (
                    <QuestionsPanel
                      interviewId={id || 'default'}
                      clerkId={user?.id || 'demo'}
                      initialQuestions={interviewData?.questions}
                    />
                  )}
```

- [ ] **Step 5: Type-check**

Run from `frontend/`: `npx tsc -b --noEmit`
Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/InterviewRoom.tsx
git commit -m "feat(ui): add Questions tab with AI generation to interview room"
```

---

### Task 10: End-to-end manual verification

- [ ] **Step 1: Verify backend unit tests pass clean**

Run from `backend/`: `npm test`
Expected: all suites (rateLimiter, leetcodeMcpClient, questionGeneratorAgent, aiController) green.

- [ ] **Step 2: Set a real OpenAI API key**

Set `OPENAI_API_KEY` in `backend/.env` to a real key (required for this task only — all automated tests use mocks and need no real key).

- [ ] **Step 3: Verify the full flow in a browser**

Start both servers (`npm run dev` in each of `backend/` and `frontend/`). Then:
1. Open an existing interview's room page.
2. Click the "Questions" tab, then "Generate questions".
3. Expected: within a few seconds (first run may be slower — `npx` downloads the LeetCode MCP server package on first invocation), 5–8 rows appear.
4. Edit one row's text, change one category, delete one row.
5. Click "Save questions". Confirm no error banner.
6. Refresh the page, click "Questions" tab again. Confirm the edited list is what reloads.

- [ ] **Step 4: Verify graceful degradation**

Temporarily break the LeetCode tool path (e.g. rename `@jinzcdev/leetcode-mcp-server` to a typo in `leetcodeMcpClient.js`'s `args`, or block network access to npm temporarily), restart the backend, click "Generate questions" on a fresh interview.
Expected: generation still succeeds (agent falls back to `tools: []`), just without any LeetCode-grounded questions. Check the backend console log for the `"leetcodeMcpClient: failed to connect..."` message. Revert the temporary change afterward.

- [ ] **Step 5: Verify the rate limit**

Click "Regenerate" 11 times in a row on the same interview. The 11th should show "Slow down — try again in Ns".

- [ ] **Step 6: Verify the provider-error path**

Temporarily unset `OPENAI_API_KEY` and restart the backend. Click "Generate". Confirm the error banner shows "AI not configured".

- [ ] **Step 7: Final commit if any tweaks were needed**

```bash
git status
# if clean, nothing to do.
# if there were fixes, commit them with a clear message.
```

---

## Self-Review Notes

- **Spec coverage:** §4.1 LeetCode MCP client → Task 3. §4.2 agent + `responseFormat` → Tasks 4–5. §4.3 route/controller/rate-limit → Tasks 2, 6–8. §4.4 config → Task 1. §5 frontend → Task 9. §6 error matrix → Tasks 5–6 (error classes + status mapping), §6's "LeetCode MCP tool connection fails → no error surfaced" → Task 3's fallback-to-`[]` behavior, verified by its own test. §7 testing → Tasks 2–3, 5–6 (automated), Task 10 (manual, including the graceful-degradation check the spec's error table promises). §9 legal/content note → Task 4's prompt instruction (a prompt-level mitigation, as the spec itself says is the extent of this plan's guarantee — no code-level similarity check, matching the spec's explicit YAGNI deferral).
- **Type/name consistency:** `generateInterviewQuestions`, `AIConfigError`, `AIProviderError`, `AIInvalidResponseError` match between Task 5 (definition) and Task 6 (consumption/mocking). `getLeetCodeTools`/`_resetLeetCodeToolsCache` match between Task 3 (definition) and Task 5 (consumption). The `Question` type (`text`/`category`/`difficulty`) is identical across the Zod schema (Task 5), the controller's `validateQuestionsPayload` (Task 8), and the frontend `Question` type (Task 9) — same three fields, same enum values, everywhere.
- **No placeholders found.**
