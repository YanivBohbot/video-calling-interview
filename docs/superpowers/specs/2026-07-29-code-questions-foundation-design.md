# Interview Code & Questions Foundation — Design

**Date:** 2026-07-29
**Status:** Approved (pending user review of written spec)
**Feature:** Sub-project 1 of 3 in the "AI agent" initiative. Lays the data foundation (persisted code snapshot + questions column) that sub-project 2 (personalized question-generator agent) and sub-project 3 (post-interview judge agent) will build on. Those two are specced separately, later.

## 1. Overview

Today the collaborative Monaco editor (`CollaborativeEditor.tsx`) is presence/broadcast only: `server.js`'s Socket.io layer relays `code-change` / `language-change` events between clients in a room but persists nothing. A page refresh loses in-progress code until another peer re-broadcasts, and there is no server-side record of what code existed in an interview once everyone disconnects.

This feature adds durable storage for the interview's code (final/latest state, not full history) and adds an empty `questions` column to `Interview`, so that:
- Code survives refreshes and is available after the interview ends (foundation for the future judge agent).
- A `questions` field exists on the schema for the future question-generator agent to fill in (this sub-project does not populate it — it ships empty).

No AI, no agents, no LangChain in this sub-project. Pure data-plumbing.

## 2. Goals / Non-goals

**Goals**
- Interview's code (content + language) is durably saved to Postgres, updated periodically while the interview is live.
- Reopening/refreshing an interview room restores the last-saved code instead of the hardcoded placeholder.
- `Interview.questions` column exists (nullable, empty) so later sub-projects have a schema seam to write into.

**Non-goals**
- Full edit history / version log of the code (only latest snapshot is kept).
- Paste-burst / anti-cheating detection (explicitly deferred — noted for a future sub-project).
- Populating `questions` (that's sub-project 2).
- Any AI/agent/LangChain work (that's sub-projects 2 and 3).
- Multi-file editor support (editor is single-file/single-language today; unchanged).

## 3. Data model

Add to `Interview` in `backend/prisma/schema.prisma`:

```prisma
model Interview {
  // ...existing fields
  codeSnapshot  String?
  codeLanguage  String?  @default("javascript")
  questions     Json?    // Array<{ text: string, category: "technical"|"behavioral"|"system-design", difficulty: "easy"|"medium"|"hard" }> — populated by a future sub-project, empty for now
}
```

Migration name: `add_code_and_questions`.

Rationale: single nullable string for the code snapshot (not a relational table) — matches the existing precedent for `questions` (`Json?` on the parent record, no separate table) since the value is always read/written as a whole with its parent interview.

## 4. Backend — code capture

### 4.1 In-memory room state (`server.js`)

Socket.io already relays `code-change` / `language-change` per room (room id == interview id, confirmed via `CollaborativeEditor roomId={id}` in `InterviewRoom.tsx`). Add an in-memory map alongside the existing relay logic:

```js
const roomState = new Map(); // roomId -> { code: string, language: string, dirty: boolean }
```

- On `code-change`: update `roomState.get(roomId).code`, set `dirty = true`. Existing broadcast to other clients in the room is unchanged.
- On `language-change`: update `roomState.get(roomId).language`, set `dirty = true`. Existing broadcast unchanged.
- If no entry exists for the room yet, create one with sensible defaults (`code: ''`, `language: 'javascript'`) before applying the update.

### 4.2 Periodic flush

A `setInterval` (every 10s) iterates `roomState`. For each entry with `dirty === true`:
- `await prisma.interview.update({ where: { id: roomId }, data: { codeSnapshot: entry.code, codeLanguage: entry.language } })`
- On success, set `dirty = false`.
- On failure (e.g. Prisma `P2025` — no such interview, covers the `roomId === 'default'` fallback case and any stale/demo rooms), swallow the error and leave `dirty = true` so it doesn't wrongly mark as saved, but do not retry-loop faster than the next tick — the next interval pass will attempt again harmlessly.

### 4.3 Flush on room empty

When a socket disconnects, check `io.sockets.adapter.rooms.get(roomId)` (or equivalent) — if the room is now empty:
- If `dirty`, perform an immediate flush (same write as 4.2).
- Delete the `roomState` entry regardless, to bound memory growth across many interviews over the server's lifetime.

### 4.4 API surface

No new REST endpoints. Existing `toInterviewDoc` shim in `backend/src/controllers/controller.js` is extended to include `codeSnapshot`, `codeLanguage`, and `questions` in the JSON returned by `GET /api/interviews/:id` (and anywhere else `toInterviewDoc` is used), following the same shim pattern used for other fields.

## 5. Frontend

`frontend/src/pages/InterviewRoom.tsx` already fetches the interview record (for existing page data). Pass two new props down:

```tsx
<CollaborativeEditor
  roomId={id || 'default'}
  initialCode={interview?.codeSnapshot ?? undefined}
  initialLanguage={interview?.codeLanguage ?? undefined}
/>
```

`CollaborativeEditor.tsx` changes:
- Accept `initialCode?: string` and `initialLanguage?: string` props.
- Use them (if present) as the initial value of the `code` / `language` state instead of the current hardcoded placeholder string and `'javascript'` default.
- No other behavior changes — the existing socket join/listen logic (which lets a second joiner sync to a first joiner's live state) takes precedence once `code-update` / `language-update` events arrive, exactly as today.

## 6. Error handling

| Failure | Behavior |
|---|---|
| Periodic flush targets a non-existent interview id (e.g. `'default'` demo room) | Prisma `P2025` caught and ignored; entry stays `dirty`, retried next tick, never crashes the interval |
| Room has zero code changes during its lifetime | No entry ever marked `dirty`; no writes issued; existing DB row (or its `@default` values) stands |
| Server restarts mid-interview | In-memory `roomState` is lost; last flushed snapshot (≤10s old) remains in DB — acceptable data-loss window, no different in kind from the current fully-in-memory behavior |

No new error paths are surfaced to the frontend — this sub-project is invisible to the user beyond "code is still there after refresh."

## 7. Testing

**Backend**
- Unit test for the room-state reducer logic (update-on-event, `dirty` flag transitions) extracted as a small pure function/module so it's testable without a live Socket.io server. (Backend currently has no test runner set up — see sub-project 2/3 specs for introducing Vitest if not already present by then; if this sub-project ships first, add the minimal Vitest setup here instead of duplicating that decision later.)
- Manual verification: open an interview room in two browser tabs, type in one, confirm the other updates live (regression check — existing behavior must be unchanged); wait 10s+, refresh both tabs, confirm the last-typed code reloads from DB.

**Frontend**
- Manual verification only (no test harness in frontend today, consistent with the existing AI-question-generator plan's approach): confirm `CollaborativeEditor` shows saved code on reload instead of the placeholder, and that a fresh interview (no snapshot yet) still shows the placeholder.

## 8. Out of scope (recorded so we don't re-litigate)

- Paste-burst / anti-cheating detection — explicitly deferred by the user during brainstorming; may be added as its own future sub-project feeding into the judge agent.
- Populating `questions` — sub-project 2 (question-generator agent).
- Reading `codeSnapshot`/`questions` for evaluation — sub-project 3 (judge agent).
- Full code history / diff timeline.
- Multi-file editor support.

## 9. Future extension notes

- Sub-project 2 (personalized question-generator agent, LangChain-based) will write into the `questions` column added here, using the same shape already defined in the earlier single-shot AI plan (`docs/superpowers/specs/2026-05-17-ai-question-generator-design.md`), but generated via an agent with tools instead of a single-shot prompt.
- Sub-project 3 (post-interview judge agent, LangChain-based) will read `codeSnapshot`, `codeLanguage`, `questions`, and `notes` as its primary evidence, plus a tool to look up the candidate's past interviews (matched by `candidateEmail`) for repeat-candidate context.
- Both future agents will need `context7` consulted during implementation for current LangChain.js API surface (`@langchain/core`, `@langchain/openai`, etc.) since the exact package/API shape should be verified against current docs rather than assumed from training data.
