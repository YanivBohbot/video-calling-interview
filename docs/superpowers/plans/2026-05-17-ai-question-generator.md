# AI Question Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate questions" button on the interview detail view that calls OpenAI (`gpt-4o-mini`) to produce 5–8 structured interview questions, lets the interviewer edit them, and persists them on the interview record.

**Architecture:** Single-shot OpenAI prompt (no agent, no streaming). A new `backend/src/lib/ai.js` module wraps the OpenAI SDK and is the seam future AI features will reuse. Questions persist as a `Json` column on `Interview`. The frontend gets a new section in `InterviewRoom.tsx` with generate/edit/save UI.

**Tech Stack:** Express 5 (ESM) + Prisma 6 (PostgreSQL) backend, React 19 + Vite + TypeScript frontend, Clerk auth via existing `protectRoute` middleware, `openai` npm SDK, Vitest for backend tests.

**Spec:** `docs/superpowers/specs/2026-05-17-ai-question-generator-design.md`

---

## File Map

**Backend — new files**
- `backend/src/lib/ai.js` — OpenAI wrapper + rate limiter + `generateInterviewQuestions`
- `backend/src/lib/prompts/questions.js` — prompt template (system + user)
- `backend/src/lib/ai.test.js` — unit tests for the wrapper
- `backend/src/lib/rateLimiter.js` — small in-memory limiter (own file so it's reusable)
- `backend/src/lib/rateLimiter.test.js` — unit tests
- `backend/src/controllers/aiController.js` — `generateQuestions` route handler
- `backend/src/controllers/aiController.test.js` — controller tests with mocked `ai.js`
- `backend/vitest.config.js` — Vitest config

**Backend — modified files**
- `backend/prisma/schema.prisma` — add `questions Json?` to `Interview`
- `backend/src/routes/interview.routes.js` — wire the new route
- `backend/src/controllers/controller.js` — extend `updateInterview` to accept `questions`
- `backend/package.json` — add `openai`, `vitest`, `test` script
- `backend/.env.example` — document `OPENAI_API_KEY`, `AI_MODEL`, `AI_QUESTION_COUNT`

**Frontend — modified files**
- `frontend/src/pages/InterviewRoom.tsx` — add `QuestionsPanel` component below the header

**Notes**
- The frontend codebase has no test harness. The spec calls for a smoke test; we defer that to a future task to avoid scope creep here (manual verification documented in Task 12).
- The repo currently has no `.env.example` for the backend. Task 1 creates one with only the new keys; pre-existing env vars (`DATABASE_URL`, etc.) are left to the developer's existing `.env`.

---

## Task 1: Install dependencies & set up Vitest

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.js`
- Create: `backend/.env.example`

- [ ] **Step 1: Install runtime + dev deps**

Run from `backend/`:
```bash
npm install openai
npm install -D vitest
```

- [ ] **Step 2: Add `test` script to `backend/package.json`**

In the `scripts` block, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `backend/vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.js"],
  },
});
```

- [ ] **Step 4: Create `backend/.env.example`**

```
# Existing — fill in your real values in .env
DATABASE_URL=

# AI feature (Task: AI Question Generator)
OPENAI_API_KEY=
AI_MODEL=gpt-4o-mini
AI_QUESTION_COUNT=6
```

- [ ] **Step 5: Verify Vitest runs (and finds nothing yet)**

Run from `backend/`: `npm test`
Expected: `No test files found, exiting with code 0` or similar — exits clean.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.js backend/.env.example
git commit -m "chore(ai): add openai sdk and vitest test harness"
```

---

## Task 2: Add `questions` column to Interview

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration directory under `backend/prisma/migrations/`

- [ ] **Step 1: Add the field to `schema.prisma`**

In the `Interview` model, after the `notes` line, add:
```prisma
  questions      Json?
```

Final `Interview` model:
```prisma
model Interview {
  id             String   @id @default(cuid())
  interviewerId  String
  interviewer    User     @relation(fields: [interviewerId], references: [id])
  candidateName  String
  candidateEmail String
  role           String
  scheduledAt    DateTime
  status         String   @default("scheduled")
  duration       Int      @default(60)
  interviewType  String   @default("technical")
  notes          String   @default("")
  questions      Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("interviews")
}
```

- [ ] **Step 2: Create and apply the migration**

Run from `backend/`:
```bash
npx prisma migrate dev --name add_interview_questions
```
Expected: migration file created under `backend/prisma/migrations/<timestamp>_add_interview_questions/`, Prisma Client regenerated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(db): add questions Json column to interviews"
```

---

## Task 3: Prompt template

**Files:**
- Create: `backend/src/lib/prompts/questions.js`

- [ ] **Step 1: Write `backend/src/lib/prompts/questions.js`**

```js
// Returns the messages array for the chat completion.
// Keeping prompts in their own file so they can be iterated without touching SDK glue.
export const buildQuestionsPrompt = ({ role, interviewType, count }) => {
  const system = [
    "You are a senior technical interviewer at a top-tier software company.",
    "You write sharp, role-specific interview questions that probe real understanding,",
    "not trivia. Mix difficulties and categories appropriately for the requested type.",
    "",
    "You MUST respond with a single JSON object of the form:",
    '{ "questions": [ { "text": string, "category": "technical"|"behavioral"|"system-design", "difficulty": "easy"|"medium"|"hard" } ] }',
    "Do not include any prose outside the JSON object.",
  ].join("\n");

  const user = [
    `Generate exactly ${count} interview questions.`,
    `Role: ${role}`,
    `Interview type: ${interviewType}`,
    "",
    "Constraints:",
    "- Questions must be specific to the role above, not generic.",
    "- For a 'technical' interview, lean technical with one or two behavioral.",
    "- For a 'behavioral' interview, lean behavioral; technical questions should still be role-relevant.",
    "- For a 'system-design' interview, lean system-design.",
    "- Vary difficulty across the set; include at least one 'hard'.",
    "- No duplicate or near-duplicate questions.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/lib/prompts/questions.js
git commit -m "feat(ai): add interview questions prompt template"
```

---

## Task 4: Rate limiter (TDD)

**Files:**
- Create: `backend/src/lib/rateLimiter.test.js`
- Create: `backend/src/lib/rateLimiter.js`

- [ ] **Step 1: Write the failing test**

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

Run: `npm test -- rateLimiter`
Expected: FAIL with `Cannot find module './rateLimiter.js'` (or similar import error).

- [ ] **Step 3: Implement `backend/src/lib/rateLimiter.js`**

```js
// In-memory token-bucket-ish limiter, sliding window of timestamps per key.
// Process-local — fine for a single-instance dev/prod. Swap for Redis when scaling out.
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

Run: `npm test -- rateLimiter`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/rateLimiter.js backend/src/lib/rateLimiter.test.js
git commit -m "feat(ai): in-memory per-key rate limiter"
```

---

## Task 5: AI module — happy path (TDD)

**Files:**
- Create: `backend/src/lib/ai.test.js`
- Create: `backend/src/lib/ai.js`

- [ ] **Step 1: Write the failing test**

`backend/src/lib/ai.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from "vitest";

// We inject a mock OpenAI client via the factory export.
const makeMockClient = (responseContent) => ({
  chat: {
    completions: {
      create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: responseContent } }],
      }),
    },
  },
});

describe("generateInterviewQuestions", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.AI_MODEL = "gpt-4o-mini";
  });

  it("returns the parsed questions array on a valid response", async () => {
    const valid = JSON.stringify({
      questions: [
        { text: "Explain CAP theorem.", category: "system-design", difficulty: "medium" },
        { text: "Tell me about a conflict.", category: "behavioral", difficulty: "easy" },
      ],
    });
    const mockClient = makeMockClient(valid);
    const { generateInterviewQuestions } = await import("./ai.js");

    const result = await generateInterviewQuestions(
      { role: "Senior Backend Engineer", interviewType: "technical", count: 2 },
      { client: mockClient },
    );

    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("system-design");
    expect(mockClient.chat.completions.create).toHaveBeenCalledOnce();
    const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
    expect(callArgs.model).toBe("gpt-4o-mini");
    expect(callArgs.response_format).toEqual({ type: "json_object" });
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- ai`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `backend/src/lib/ai.js` (minimal happy path)**

```js
import OpenAI from "openai";
import { buildQuestionsPrompt } from "./prompts/questions.js";
import { createRateLimiter } from "./rateLimiter.js";

let defaultClient = null;
const getDefaultClient = () => {
  if (defaultClient) return defaultClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AIConfigError("AI not configured: OPENAI_API_KEY missing");
  defaultClient = new OpenAI({ apiKey });
  return defaultClient;
};

export class AIConfigError extends Error {}
export class AIProviderError extends Error {}
export class AIInvalidResponseError extends Error {}
export class AIRateLimitError extends Error {
  constructor(retryAfter) {
    super("AI rate limit exceeded");
    this.retryAfter = retryAfter;
  }
}

export const questionsLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

const ALLOWED_CATEGORY = new Set(["technical", "behavioral", "system-design"]);
const ALLOWED_DIFFICULTY = new Set(["easy", "medium", "hard"]);

const validateQuestions = (parsed) => {
  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new AIInvalidResponseError("Response missing 'questions' array");
  }
  for (const q of parsed.questions) {
    if (typeof q?.text !== "string" || !q.text.trim()) {
      throw new AIInvalidResponseError("Question missing text");
    }
    if (!ALLOWED_CATEGORY.has(q.category)) {
      throw new AIInvalidResponseError(`Invalid category: ${q.category}`);
    }
    if (!ALLOWED_DIFFICULTY.has(q.difficulty)) {
      throw new AIInvalidResponseError(`Invalid difficulty: ${q.difficulty}`);
    }
  }
  return parsed.questions;
};

export const generateInterviewQuestions = async (
  { role, interviewType, count },
  { client } = {},
) => {
  const c = client || getDefaultClient();
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  const messages = buildQuestionsPrompt({ role, interviewType, count });

  let completion;
  try {
    completion = await c.chat.completions.create({
      model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.7,
    });
  } catch (err) {
    throw new AIProviderError(`OpenAI request failed: ${err.message}`);
  }

  const raw = completion?.choices?.[0]?.message?.content;
  if (!raw) throw new AIInvalidResponseError("Empty response from OpenAI");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AIInvalidResponseError("Response was not valid JSON");
  }

  return validateQuestions(parsed);
};
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- ai`
Expected: the happy-path test passes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/ai.js backend/src/lib/ai.test.js
git commit -m "feat(ai): generateInterviewQuestions wrapper around OpenAI"
```

---

## Task 6: AI module — validation & error paths

**Files:**
- Modify: `backend/src/lib/ai.test.js`

- [ ] **Step 1: Add failing tests for invalid/error cases**

Append to `backend/src/lib/ai.test.js` inside the same `describe`:
```js
  it("throws AIInvalidResponseError on unparseable JSON", async () => {
    const mockClient = makeMockClient("not json at all");
    const { generateInterviewQuestions, AIInvalidResponseError } = await import("./ai.js");
    await expect(
      generateInterviewQuestions(
        { role: "x", interviewType: "technical", count: 1 },
        { client: mockClient },
      ),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });

  it("throws AIInvalidResponseError when category is wrong", async () => {
    const bad = JSON.stringify({
      questions: [{ text: "Q", category: "trivia", difficulty: "easy" }],
    });
    const mockClient = makeMockClient(bad);
    const { generateInterviewQuestions, AIInvalidResponseError } = await import("./ai.js");
    await expect(
      generateInterviewQuestions(
        { role: "x", interviewType: "technical", count: 1 },
        { client: mockClient },
      ),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });

  it("throws AIProviderError when the SDK call rejects", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("boom")),
        },
      },
    };
    const { generateInterviewQuestions, AIProviderError } = await import("./ai.js");
    await expect(
      generateInterviewQuestions(
        { role: "x", interviewType: "technical", count: 1 },
        { client: mockClient },
      ),
    ).rejects.toBeInstanceOf(AIProviderError);
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test -- ai`
Expected: all four tests pass (no implementation changes needed — Task 5 already covers these paths). If any fail, fix the implementation in `ai.js` until they pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/ai.test.js
git commit -m "test(ai): cover invalid response and provider error paths"
```

---

## Task 7: AI controller (TDD)

**Files:**
- Create: `backend/src/controllers/aiController.test.js`
- Create: `backend/src/controllers/aiController.js`

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

vi.mock("../lib/ai.js", () => ({
  generateInterviewQuestions: vi.fn(),
  questionsLimiter: { check: vi.fn() },
  AIProviderError: class AIProviderError extends Error {},
  AIInvalidResponseError: class AIInvalidResponseError extends Error {},
  AIConfigError: class AIConfigError extends Error {},
}));

import { prisma } from "../lib/db.js";
import {
  generateInterviewQuestions,
  questionsLimiter,
  AIProviderError,
} from "../lib/ai.js";
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
  questionsLimiter.check.mockReturnValue({ ok: true });
});

describe("generateQuestions controller", () => {
  it("returns 404 when interview not found", async () => {
    prisma.interview.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await generateQuestions(baseReq, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 429 when rate limited", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-1", role: "x", interviewType: "technical" });
    questionsLimiter.check.mockReturnValue({ ok: false, retryAfter: 42 });
    const res = mockRes();
    await generateQuestions(baseReq, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: 42 }));
  });

  it("returns 502 when the AI provider fails", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-1", role: "x", interviewType: "technical" });
    generateInterviewQuestions.mockRejectedValue(new AIProviderError("boom"));
    const res = mockRes();
    await generateQuestions(baseReq, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("returns 200 with the questions array on success", async () => {
    prisma.interview.findUnique.mockResolvedValue({ id: "iv-1", role: "Backend", interviewType: "technical" });
    const questions = [{ text: "Q1", category: "technical", difficulty: "easy" }];
    generateInterviewQuestions.mockResolvedValue(questions);
    const res = mockRes();
    await generateQuestions(baseReq, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ questions });
    expect(generateInterviewQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ role: "Backend", interviewType: "technical" }),
    );
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- aiController`
Expected: FAIL — `aiController.js` not found.

- [ ] **Step 3: Implement `backend/src/controllers/aiController.js`**

```js
import { prisma } from "../lib/db.js";
import {
  generateInterviewQuestions,
  questionsLimiter,
  AIProviderError,
  AIInvalidResponseError,
  AIConfigError,
} from "../lib/ai.js";

const DEFAULT_COUNT = Number(process.env.AI_QUESTION_COUNT || 6);

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

- [ ] **Step 4: Run and verify all tests pass**

Run: `npm test`
Expected: all tests (rateLimiter, ai, aiController) pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/aiController.js backend/src/controllers/aiController.test.js
git commit -m "feat(ai): controller for POST /interviews/:id/questions/generate"
```

---

## Task 8: Wire the route

**Files:**
- Modify: `backend/src/routes/interview.routes.js`

- [ ] **Step 1: Import and register the route**

Replace `backend/src/routes/interview.routes.js` with:
```js
import express from "express";
import controller from "../controllers/controller.js";
import aiController from "../controllers/aiController.js";
import { protectRoute } from "../middlewares/protectRoute.js";

const router = express.Router();

// Aggregate routes — must be declared before /:id to avoid shadowing
router.get("/stats", controller.getInterviewStats);
router.get("/activity", controller.getRecentActivity);

// List / create
router.get("/", controller.listInterviews);
router.post("/", controller.createInterview);

// AI: generate questions for an interview (must come before generic /:id PATCH/GET)
router.post("/:id/questions/generate", protectRoute, aiController.generateQuestions);

// Single interview
router.get("/:id", controller.getInterview);
router.patch("/:id/status", controller.updateInterviewStatus);
router.patch("/:id", controller.updateInterview);
router.delete("/:id", controller.deleteInterview);

export default router;
```

- [ ] **Step 2: Manual sanity check — start the server**

Run from `backend/`:
```bash
npm run dev
```
Expected: server boots without errors. Stop it with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/interview.routes.js
git commit -m "feat(ai): wire POST /interviews/:id/questions/generate route"
```

---

## Task 9: Extend `updateInterview` to accept `questions`

**Files:**
- Modify: `backend/src/controllers/controller.js`

- [ ] **Step 1: Update `updateInterview` (around line 152)**

Replace the existing `updateInterview` function with:
```js
const ALLOWED_CATEGORY = new Set(["technical", "behavioral", "system-design"]);
const ALLOWED_DIFFICULTY = new Set(["easy", "medium", "hard"]);

const validateQuestionsPayload = (questions) => {
  if (!Array.isArray(questions)) return "questions must be an array";
  for (const q of questions) {
    if (typeof q?.text !== "string" || !q.text.trim()) return "each question needs non-empty text";
    if (!ALLOWED_CATEGORY.has(q.category)) return `invalid category: ${q.category}`;
    if (!ALLOWED_DIFFICULTY.has(q.difficulty)) return `invalid difficulty: ${q.difficulty}`;
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

Place `ALLOWED_CATEGORY`, `ALLOWED_DIFFICULTY`, and `validateQuestionsPayload` at the top of the file's "Interviews" section so they're hoisted before use.

- [ ] **Step 2: Manual verification — PATCH with valid questions**

Start the server (`npm run dev`), then in another shell:
```bash
curl -X PATCH http://localhost:3000/api/interviews/<some-existing-id> \
  -H "Content-Type: application/json" \
  -H "x-clerk-id: demo" \
  -d '{"questions":[{"text":"Test Q","category":"technical","difficulty":"easy"}]}'
```
Expected: 200, response includes the questions. PATCH with `{"questions":[{"text":"","category":"foo","difficulty":"bar"}]}` should 400.

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/controller.js
git commit -m "feat(api): allow saving questions array via PATCH /interviews/:id"
```

---

## Task 10: Frontend — QuestionsPanel component

**Files:**
- Modify: `frontend/src/pages/InterviewRoom.tsx`

- [ ] **Step 1: Add the component at the top of `InterviewRoom.tsx` (after the existing imports, before `ReportModal`)**

```tsx
type Question = {
  text: string;
  category: 'technical' | 'behavioral' | 'system-design';
  difficulty: 'easy' | 'medium' | 'hard';
};

const API = 'http://localhost:3000/api';

const QuestionsPanel: React.FC<{ interviewId: string; clerkId: string }> = ({
  interviewId,
  clerkId,
}) => {
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Load existing questions on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/interviews/${interviewId}`);
        const iv = await r.json();
        if (!cancelled && Array.isArray(iv?.questions)) setQuestions(iv.questions);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

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

  const deleteRow = (i: number) =>
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));

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
    <div className="bg-slate-800/60 rounded-2xl border border-white/10 p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-brand" />
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
          <div
            key={i}
            className="bg-slate-900/60 border border-white/5 rounded-xl p-3 flex flex-col gap-2"
          >
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
                onChange={(e) =>
                  updateRow(i, { difficulty: e.target.value as Question['difficulty'] })
                }
                className="bg-slate-800 border border-white/10 rounded px-2 py-1 text-slate-200"
              >
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </select>
              <button
                onClick={() => deleteRow(i)}
                className="ml-auto text-slate-500 hover:text-red-400"
              >
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

- [ ] **Step 2: Render `QuestionsPanel` inside the room view**

Find the main component in `InterviewRoom.tsx` (the default export that renders the Stream call). Inside its returned JSX, near where the interview header / controls render — above the `SpeakerLayout` / `CallControls` area — add:
```tsx
{interviewId && user?.id && (
  <QuestionsPanel interviewId={interviewId} clerkId={user.id} />
)}
```

`interviewId` is already available via `useParams()`; `user` from `useUser()`. If the existing component uses different variable names, match them.

- [ ] **Step 3: Manual UI check**

Run `npm run dev` in `frontend/` and `backend/`. Open an interview in the browser, verify:
- "Generate questions" button is visible.
- Clicking it shows a spinner, then renders rows (assuming `OPENAI_API_KEY` is set).
- Edits stay in local state; "Save questions" persists them (re-load the page → questions are still there).
- Without `OPENAI_API_KEY`, the error banner shows "AI not configured".

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/InterviewRoom.tsx
git commit -m "feat(ui): AI questions panel on interview room"
```

---

## Task 11: README / dev note

**Files:**
- Modify: `backend/.env.example` (already exists from Task 1; verify content)

- [ ] **Step 1: Confirm `.env.example` contains the AI section**

Open `backend/.env.example` and confirm it has:
```
OPENAI_API_KEY=
AI_MODEL=gpt-4o-mini
AI_QUESTION_COUNT=6
```
If a project README exists at the repo root, add a one-line note under "Environment variables" that points developers to `backend/.env.example`. If no README, skip.

- [ ] **Step 2: Commit (only if something changed)**

```bash
git add -A
git diff --cached --quiet || git commit -m "docs(ai): document OPENAI_API_KEY in .env.example"
```

---

## Task 12: End-to-end manual verification

This is the spec's "frontend smoke test" deliberately scoped down to a manual checklist — no RTL setup added in this plan.

- [ ] **Step 1: Verify backend tests pass clean**

Run from `backend/`: `npm test`
Expected: all suites green (rateLimiter, ai, aiController).

- [ ] **Step 2: Verify the full flow in a browser**

Set `OPENAI_API_KEY` in `backend/.env`. Start both servers (`npm run dev` in each). Then:
1. Open an existing interview's room page.
2. Click "Generate questions". Confirm 5–8 rows appear within a few seconds.
3. Edit one row's text, change one category, delete one row.
4. Click "Save questions". Confirm no error banner.
5. Refresh the page. Confirm the edited list is what reloads.

- [ ] **Step 3: Verify the rate limit**

Click "Regenerate" 11 times in a row. The 11th should show "Slow down — try again in Ns".

- [ ] **Step 4: Verify the provider-error path**

Temporarily unset `OPENAI_API_KEY` and restart the backend. Click "Generate". Confirm the error banner shows "AI not configured".

- [ ] **Step 5: Final commit if any tweaks were needed**

```bash
git status
# if clean, nothing to do.
# if there were fixes, commit them with a clear message.
```

---

## Self-Review Notes

- **Spec coverage:** §3 data model → Task 2. §4.1 ai.js → Tasks 3–6. §4.2 route → Tasks 7–8. §4.3 update endpoint → Task 9. §4.4 rate limiter → Tasks 4, 7. §5 frontend → Task 10. §6 config → Tasks 1, 11. §7 error matrix → Tasks 5–7, 9. §8 testing → Tasks 4–7 cover backend; frontend smoke test downgraded to manual checklist in Task 12 (called out in the file map "Notes").
- **Type consistency:** `Question` shape is identical across `ai.js` validation (Task 5), controller (Task 7), Prisma JSON column (Task 2), backend update validator (Task 9), and frontend `Question` type (Task 10). Error class names match between `ai.js` and `aiController.js`.
- **No placeholders found.**
