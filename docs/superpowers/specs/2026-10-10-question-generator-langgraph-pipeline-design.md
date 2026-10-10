# Question-Generator Pipeline — LangGraph Design

**Date:** 2026-10-10
**Status:** Approved (pending user review of written spec)
**Feature:** Replaces the single `createAgent` call that generates interview questions with an explicit LangGraph pipeline. Driven by wanting the pipeline to visibly demonstrate — as separate, inspectable units — planning, tool selection, delegation, state/memory management, execution, retries, fallbacks, error recovery, and human-in-the-loop approval. This is a portfolio/demo goal: depth and legibility of each named pattern matters more than minimal diff from the current code.

**Supersedes (implementation only):** `docs/superpowers/specs/2026-07-29-question-generator-agent-design.md`. That spec's goals, data model, legal/paraphrase note, and frontend UX carry forward unchanged (see below). This spec replaces only its §4.2 (single `createAgent` call) with a multi-node graph, and extends its §4.3 route/controller contract with a new approve/resume step.

## 1. Overview

Today, `POST /interviews/:id/questions/generate` runs one `createAgent(...).invoke(...)` call and returns questions directly; the interviewer's only "review" is editing the rows in the UI before a plain `PATCH /interviews/:id`. This spec restructures generation into a `StateGraph` with seven nodes, each one a named, separately testable implementation of one of the required patterns:

```
START → planner → researcher → drafter → validator ─┬─(valid)→ humanApproval ─┬─(approved)→ finalize → END
                        ▲            │                │                       └─(rejected)→ END
                        │            └─(invalid, retries left)→ drafter (loop)
                        └─(invalid, retries exhausted)→ fallback → drafter (one more pass)
```

The human-approval pause is a real `interrupt()` on a durable (Postgres-backed) checkpoint — not a UI convention — so resuming it requires a new HTTP call, not just editing local state.

## 2. Goals / Non-goals

**Goals**
- Same end-user goal as the superseded spec: role-personalized questions, optionally grounded in a real LeetCode problem, interviewer can edit before anything is saved.
- Each of the eight required concepts maps to one concrete, nameable graph element (see §4.2–§4.4).
- The approval pause survives a process restart (Postgres checkpointer), demonstrating real state/memory management, not a toy in-memory flag.
- `Interview.questions` keeps its current shape (plain array of `{text, category, difficulty}`) — no Prisma migration, no change to how `InterviewRoom.tsx` stores saved questions.

**Non-goals**
- Cross-interview long-term memory (LangGraph's `Store` layer) — each generation is scoped to one `jobId`; nothing persists across different interviews.
- Streaming token-by-token output.
- A reusable generic graph-execution framework — this graph is specific to question generation.
- Changes to `leetcodeMcpClient.js` — reused as-is.
- Removing the generic `PATCH /interviews/:id { questions }` free-edit path — it stays available for any edit outside this flow.

## 3. Data model

None. No Prisma migration. `@langchain/langgraph-checkpoint-postgres`'s `PostgresSaver` manages its own tables via `.setup()`, entirely separate from the Prisma-managed schema — this is a library-internal detail, not a modeled part of the app's data.

## 4. Backend

### 4.1 State — `backend/src/lib/agents/questionGenerator/state.js`

```js
import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const QuestionSchema = z.object({
  text: z.string(),
  category: z.enum(["technical", "behavioral", "system-design"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
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

No reducers needed — every field is overwritten by the node that owns it, never accumulated across parallel branches (no fan-out in this graph).

### 4.2 Nodes — `backend/src/lib/agents/questionGenerator/nodes.js`

- **`planner`** *(planning)* — one small LLM call (or, if the model proves unreliable at this trivial task, deterministic logic — decided during implementation, not this spec) turning `{role, interviewType, count}` into `plan.categoryCounts`, e.g. `{technical: 4, behavioral: 1, "system-design": 1}`. Pure decision step, no tools.
- **`researcher`** *(tool selection)* — decides *whether* LeetCode grounding is appropriate (same agent-discretion principle as the superseded spec: not hardcoded on `interviewType`), calls `getLeetCodeTools()` from the existing `leetcodeMcpClient.js` only if so, stores short text snippets into `research`. `retryPolicy: { maxAttempts: 3 }` — transient tool/network failures retry automatically at the LangGraph level (see §4.3's error table).
- **`drafter`** *(delegation)* — a distinct, narrowly-scoped sub-agent (its own `createAgent` call, own system prompt in `prompts/questionGenerator.js`) that only drafts questions from `plan` + `research` + `useFallbackModel`. It does not decide counts or tools — those were already decided upstream and handed to it, which is what makes this delegation rather than one agent doing everything. `retryPolicy: { maxAttempts: 3 }` for transient LLM failures.
- **`validator`** *(execution, error recovery)* — pure code, no LLM call: checks `draftQuestions` against `QuestionSchema` plus business rules (count matches `plan`, non-empty text, no duplicate text). Returns a `Command`:
  - valid → `goto: "humanApproval"`
  - invalid, `retryCount < MAX_CONTENT_RETRIES` (2) → `goto: "drafter"`, `update: { retryCount: retryCount + 1, validationErrors }`
  - invalid, retries exhausted, `!useFallbackModel` → `goto: "fallback"`
  - invalid, `useFallbackModel` already true (i.e. this is the fallback's one retry and it also failed) → **throws** `AIInvalidResponseError` directly (unexpected/developer tier — bubbles up per the 4-tier error model, same exception type the controller already catches).
- **`fallback`** *(fallback)* — sets `useFallbackModel: true`, bumps `retryCount` by 1 (does **not** reset it to 0), routes back to `drafter`. This guarantees exactly one extra attempt: the next `validator` check already has `useFallbackModel: true`, so a second failure throws instead of looping again.
- **`humanApproval`** *(human-in-the-loop)* — no DB write before `interrupt()` (idempotency rule). Calls `interrupt({ draftQuestions: state.draftQuestions, plan: state.plan })`, which pauses the graph and surfaces that payload as `__interrupt__` to the caller. On resume, `Command.resume` arrives as `{ approved, questions? }`. Returns `Command({ goto: approved ? "finalize" : END, update: { approval: { approved, questions } } })`.
- **`finalize`** *(execution)* — only reached when approved. Persists `approval.questions ?? draftQuestions` into `interview.questions` via the existing Prisma singleton (`import { prisma } from "../../db.js"`), same column, same shape as today's `PATCH` handler.

### 4.3 Graph wiring & error tiers — `backend/src/lib/agents/questionGenerator/graph.js`

```js
import { StateGraph, START, END } from "@langchain/langgraph";
import { QuestionGenState } from "./state.js";
import { planner, researcher, drafter, validator, fallback, humanApproval, finalize } from "./nodes.js";

export const buildGraph = (checkpointer) =>
  new StateGraph(QuestionGenState)
    .addNode("planner", planner)
    .addNode("researcher", researcher, { retryPolicy: { maxAttempts: 3 } })
    .addNode("drafter", drafter, { retryPolicy: { maxAttempts: 3 } })
    .addNode("validator", validator, { ends: ["humanApproval", "drafter", "fallback"] })
    .addNode("fallback", fallback)
    .addNode("humanApproval", humanApproval, { ends: ["finalize", END] })
    .addNode("finalize", finalize)
    .addEdge(START, "planner")
    .addEdge("planner", "researcher")
    .addEdge("researcher", "drafter")
    .addEdge("drafter", "validator")
    .addEdge("fallback", "drafter")
    .addEdge("finalize", END)
    .compile({ checkpointer });
```

This is exactly LangGraph's own 4-tier error model, not a bespoke scheme:

| Error type | Who fixes | Mechanism here |
|---|---|---|
| Transient (OpenAI rate limit, LeetCode MCP network blip) | System | `retryPolicy` on `researcher`/`drafter` |
| Content-invalid (bad schema, wrong count) | LLM | `validator → drafter` conditional loop, bounded by `retryCount` |
| Exhausted retries | System (fallback) | `fallback` node: swap model, one more pass |
| Still invalid after fallback | Developer | `validator` throws `AIInvalidResponseError`, bubbles to controller's existing catch (502) |
| User-fixable (needs a human decision) | Human | `humanApproval`'s `interrupt()` |

### 4.4 Persistence — thread id & checkpointer

`thread_id = "${interviewId}:${jobId}"`, `jobId = crypto.randomUUID()` minted fresh each time `/generate` is called — so clicking "Regenerate" while an earlier draft is still pending approval doesn't collide; the old thread is simply abandoned.

```js
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let checkpointer;
export const getCheckpointer = () => {
  if (!checkpointer) checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL);
  return checkpointer;
};

export const ensureCheckpointerTables = () => getCheckpointer().setup(); // idempotent, called once at boot
```

`server.js` calls `ensureCheckpointerTables()` at boot, guarded the same way the recent "warm LeetCode MCP at boot" fix warms that client — a logged, non-fatal best-effort call, not a hard startup dependency.

### 4.5 Route & controller — `backend/src/controllers/aiController.js`

- `POST /interviews/:id/questions/generate` (still behind `protectRoute` + the existing `questionsLimiter`): builds the graph, `invoke()`s with a fresh `thread_id`, runs until the `interrupt`. Response becomes:
  ```json
  { "jobId": "...", "status": "pending_approval", "draftQuestions": [...], "plan": {...} }
  ```
  (was `{ "questions": [...] }` — this is the one breaking response-shape change, scoped to this one endpoint.)
- New `POST /interviews/:id/questions/approve` (same `protectRoute`), body `{ jobId, approved, questions? }`: validates `jobId` starts with `${req.params.id}:` (reject otherwise — a thread id is also a capability token across interviews), resumes with `Command({ resume: { approved, questions } })`. Approved → responds `toInterviewDoc(updatedInterview)` (same shape `PATCH` already returns); rejected → `{ status: "rejected" }`, no DB write.
- `startQuestionGeneration`/`resumeQuestionGeneration` exported from `graph.js` take an optional `{ graph }` override, mirroring the current `generateInterviewQuestions(..., { agent })` dependency-injection pattern so tests never build a real graph or hit OpenAI/Postgres.

### 4.6 Configuration

Adds to the existing env surface (`OPENAI_API_KEY`, `AI_MODEL`, `AI_QUESTION_COUNT`):
```
AI_MODEL_FALLBACK=gpt-4o
```
`DATABASE_URL` is already set (used by Prisma) — reused as-is for the checkpointer.

## 5. Frontend — `frontend/src/pages/InterviewRoom.tsx`, `QuestionsPanel`

- Generate handler reads `body.draftQuestions` (not `body.questions`) and also keeps `jobId` in component state.
- The existing edit grid is unchanged.
- "Save questions" button now `POST`s to `/questions/approve` with `{ jobId, approved: true, questions }` instead of `PATCH /interviews/:id`.
- A new "Discard" button sends `{ jobId, approved: false }`.
- `onSaved` callback unchanged — it still receives the final `Question[]` array, now from the approve response's `interview.questions` instead of the PATCH response.

## 6. Error handling

| Failure | Response |
|---|---|
| Interview not found | 404 |
| Missing `OPENAI_API_KEY` | 500, `"AI not configured"` |
| LeetCode MCP unavailable | No error — `researcher` proceeds with empty `research` |
| Transient LLM/tool failure, retries remain | Retried automatically, invisible to caller |
| Content invalid after fallback exhausted | 502 (`AIInvalidResponseError`) |
| Rate limit exceeded | 429 with `retryAfter` |
| `jobId` doesn't belong to `:id`, or thread already resolved | 404 on `/approve` |
| Approve/reject payload malformed | 400 |

## 7. Testing

- `nodes.js` — unit test each node function directly: `planner`'s count distribution, `researcher` with/without tools available, `validator`'s three-way `Command` branch (valid / retry / fallback), `fallback`'s state reset, `humanApproval`'s `Command` branch on both resume values, `finalize`'s Prisma call (mocked client).
- `graph.js` — one integration-style test using `InMemorySaver` (not Postgres) and a fully mocked `drafter` model call: happy path to interrupt, resume-approved persists, resume-rejected doesn't write, forced-invalid-output path reaches `fallback` then throws.
- `aiController.js` — extend `aiController.test.js`: 200 pending-approval shape on generate, 200/404/400 on approve, same DI-via-`{graph}`-override pattern the existing tests already use for `{agent}`.
- No change to the frontend smoke-test expectations beyond the renamed response fields.

## 8. Out of scope (recorded so it isn't re-litigated)

- Long-term cross-interview memory (`Store`).
- Deterministic (non-LLM) seniority/domain parsing — still the model's own inference, per the superseded spec.
- A generic/reusable graph runner for other agents in this codebase.
- Changing LeetCode tool allowlist or client behavior.
- Removing `PATCH /interviews/:id`'s ability to accept `questions`.

## 9. Legal / content note (carried forward unchanged)

Same as the superseded spec §9: the `drafter` prompt instructs paraphrasing of any LeetCode-sourced problem rather than verbatim reproduction. Still a prompt-level instruction, not code-enforced.

## 10. Future extension notes

- If a later feature needs to show *why* a question was generated (which plan slot, which research snippet it came from), `state.plan`/`state.research` are already there to surface — currently discarded after `finalize`.
- The `jobId`-scoped thread could be listed (`GET /interviews/:id/questions/pending`) if multiple interviewers ever need to see "someone already generated a pending batch" — not needed now (one interviewer per interview room today).
