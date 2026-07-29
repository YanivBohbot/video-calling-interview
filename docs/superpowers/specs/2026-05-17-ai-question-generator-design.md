# AI Question Generator — Design

**Date:** 2026-05-17
**Status:** OBSOLETE — superseded by `docs/superpowers/specs/2026-07-29-question-generator-agent-design.md` (agent with LangChain tool-calling, replaces this single-shot design). Never implemented. Kept as historical record.
**Feature:** First of four planned AI features. Subsequent features (summarizer, resume screener, coding-session assistant) will be specced separately.

## 1. Overview

Add a "Generate questions" action on the interview detail view. It calls a new backend endpoint that uses OpenAI `gpt-4o-mini` to produce 5–8 role-appropriate questions for the interview's `role` + `interviewType`. Each question is structured (`text`, `category`, `difficulty`). The interviewer reviews and edits the list, then saves it onto the interview record. Saved questions are visible in `InterviewRoom`.

The feature is deliberately a single-shot prompt — no agent loop, no tools, no streaming. See the project conversation for why an agent is overkill here.

## 2. Goals / Non-goals

**Goals**
- One click → 5–8 high-quality, role-appropriate interview questions.
- Interviewer can edit any field before saving.
- Saved questions persist on the interview and render in the interview room.
- Foundation (`backend/src/lib/ai.js`) reusable by the next three AI features.

**Non-goals**
- Streaming responses.
- Per-question scoring or candidate feedback.
- Multi-language prompts.
- Agent / multi-step reasoning.
- The other three AI features.

## 3. Data model

Add one nullable JSON column to `Interview`:

```prisma
model Interview {
  // ... existing fields
  questions Json?  // Array<{ text: string, category: "technical" | "behavioral" | "system-design", difficulty: "easy" | "medium" | "hard" }>
}
```

Rationale for `Json` over a separate `Question` table: questions are always read and written together with their parent interview, never queried individually. A relational table would add joins and migrations for no gain. Revisit only if a future feature needs to query across questions (e.g. "show me all behavioral questions I've ever generated").

Migration name: `add_interview_questions`.

## 4. Backend

### 4.1 AI module — `backend/src/lib/ai.js`

A small wrapper around the OpenAI SDK. This module is the seam every future AI feature plugs into.

Exports:
- `generateInterviewQuestions({ role, interviewType, count }) → Promise<Question[]>`

Behavior:
- Reads `OPENAI_API_KEY`, `AI_MODEL` (default `gpt-4o-mini`), `AI_QUESTION_COUNT` (default `6`) from env.
- Calls `chat.completions.create` with `response_format: { type: "json_object" }` for guaranteed parseable output.
- Validates the parsed response shape (array length, allowed `category` and `difficulty` enums). Throws a typed error on invalid shape so the route can return 502.
- Prompt template lives in `backend/src/lib/prompts/questions.js` — a single exported function that takes `{ role, interviewType, count }` and returns the system + user messages. Kept separate so prompts can be iterated without touching the SDK glue.

### 4.2 Route — `POST /api/interviews/:id/questions/generate`

Wired in `backend/src/routes/interview.routes.js`, controller in `backend/src/controllers/controller.js`.

- Protected by existing `protectRoute` middleware.
- Loads the interview by `:id`; 404 if missing.
- Calls `generateInterviewQuestions` with the interview's `role` + `interviewType`.
- Returns the generated array. **Does not auto-save** — the interviewer reviews and explicitly saves via the existing update endpoint.
- Errors: 502 on provider failure or invalid AI output, 429 on rate-limit exhaustion (see 4.4), 404 on missing interview.

### 4.3 Extend `updateInterview`

The existing `PATCH /api/interviews/:id` (or whichever update route the frontend already uses) accepts an additional optional field `questions: Question[]`. Server-side validation: array, each item matches the schema in section 3. Reject malformed payloads with 400.

### 4.4 Rate limiting

Simple in-memory per-`clerkId` limiter on the generate endpoint: 10 generations per rolling hour. Lives in `ai.js` so it can be swapped for a Redis-backed limiter later. On exhaustion, return 429 with a `retryAfter` seconds value. This is the cost guard — without it a runaway frontend bug or a curious user could blow through the OpenAI budget.

## 5. Frontend

Target file: `frontend/src/pages/InterviewRoom.tsx` (the existing interview detail / room view).

UI additions:
- A "Generate questions" button near the interview header. Shows a spinner while the request is in flight.
- A questions panel below the existing interview info:
  - If `interview.questions` is non-empty on load, render those rows with a "Regenerate" button.
  - After generation, render the returned array as editable rows: text input, `category` select, `difficulty` select, delete button per row.
  - A "Save questions" button issues a PATCH to the interview update endpoint with the current array.
- Loading, error, and rate-limit (429) states all surface in a single toast/inline message — no partial-state saves.

No new routing, no new top-level page.

## 6. Configuration

`backend/.env` (and `.env.example`):
```
OPENAI_API_KEY=
AI_MODEL=gpt-4o-mini
AI_QUESTION_COUNT=6
```

`OPENAI_API_KEY` is required at boot. If missing, `ai.js` throws on first use rather than at startup, so unrelated routes still work in local dev without a key — but the generate endpoint will return 500 with a clear message.

## 7. Error handling

| Failure | Response |
|---|---|
| Interview not found | 404 |
| Missing `OPENAI_API_KEY` at call time | 500 with `"AI not configured"` |
| OpenAI provider error (network, 5xx, timeout) | 502 |
| OpenAI returns invalid / unparseable JSON | 502 (validated in `ai.js`, never reaches DB) |
| Rate limit exceeded | 429 with `retryAfter` |
| Saving invalid `questions` payload | 400 |

No partial saves under any failure mode. The frontend never persists AI output until the user clicks "Save".

## 8. Testing

**Backend (unit)**
- `generateInterviewQuestions` with a mocked OpenAI client: happy path returns parsed array; invalid-JSON path throws; wrong-shape path throws.
- Rate limiter: 11th call within an hour throws / returns the expected error.

**Backend (route)**
- `POST .../questions/generate`: 200 happy path, 404 on missing interview, 502 on mocked provider error, 429 after exhausting the limit.
- `PATCH .../:id` with valid `questions`: persists. With malformed `questions`: 400.

**Frontend (smoke)**
- Clicking "Generate" calls the endpoint and renders rows.
- Editing a row and clicking "Save" issues a PATCH with the edited payload.

## 9. Out of scope (recorded so we don't re-litigate)

- Streaming.
- Persisted per-question candidate answers / scoring.
- Multi-language prompts.
- LangChain / LangGraph / agent loops.
- Provider abstraction (we'll add it only when a second provider is actually needed).
- Resume-screener, summarizer, coding-assistant features.

## 10. Future extension notes

- When feature #2 (summarizer) lands, it will add `generateInterviewSummary` to the same `ai.js` module and reuse the rate limiter and error contract.
- When feature #4 (coding assistant) lands, it will live in `backend/src/lib/agents/` and may introduce a hand-rolled tool-calling loop. The flat `ai.js` wrapper stays as the single-shot path.
