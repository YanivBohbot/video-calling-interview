# Stage 1b — AI interviewer in the existing room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI interviewer becomes a panel of the existing interview room: the invited candidate chats with it while coding in the shared editor; the human interviewer, in the same room, follows the conversation and reads the report.

**Architecture:** No new page. The stage-1a backend (agents, service, repository, SSE) is kept; only its door changes: the routes move from `/api/practice` (separate practice link, `practice` principal) to `/api/interviews/:id/ai` behind the normal `authenticate`, open to the invited candidate (chat) and the owner (read). The practice link, its principal and its two columns are removed. Frontend: one API file (`lib/aiInterviewer.ts`), one panel component used by both rooms, and an `onCodeChange` callback on `CollaborativeEditor` so the panel sends the code the candidate is writing.

**Tech Stack:** Express 5 (existing layers), Prisma 6, React 19 + TS + Vite 7, Tailwind 4, `fetch` + `ReadableStream` for SSE, Vitest 4 in the frontend (node environment, pure logic only).

**Spec:** `docs/superpowers/specs/2026-11-22-practice-interviewer-design.md`, **revised by the user on 2026-11-22** (Task 1 writes the revision into the spec):
- the AI is in the existing room, reached with the existing invite link — no separate practice link;
- only the candidate chats with the AI;
- the interviewer sees the conversation live and the report (the earlier "report for the candidate only" is dropped).

**Branch:** `feat/stage1b-ai-in-room`, created from `feat/stage1-practice`.

## Global Constraints

- Keep it simple (user, 2026-11-22): no new state library, UI library, socket event or scaling work. The backend keeps its layers and file names (`practice.service.js`, `practiceSession.repository.js`, the agents); only routes and access rules change.
- Access, checked in the service: **candidate** principal whose `interviewId` is `:id` → start, send, finish, read. **Owner** (`interviewer`/`demo` owning `:id`) → read and finish, never send or start. Anyone else → 404.
- Caps unchanged: 3 sessions per **interview**, 60 min and 60 messages per session, one reply at a time, 10 messages/min per interview.
- The interviewer's live view is **polling** `GET …/sessions/:sid` every 3000 ms while a session is active (no new socket event). Tokens stream only on the candidate's screen.
- Notice on the candidate's panel before "Start": `You are talking to an AI interviewer. Your code and messages are sent to OpenAI. The interviewer can read this conversation and the report.`
- UI copy in English. SSE events: `token {text}`, `tool {name}`, `done {ended, limited}`, `error {message}`; refusals are JSON `{ message }` before the stream.
- Backend `npm test`, frontend `npm test`, `npm run build`, `npm run lint` stay clean.

## Review Focus

1. An SSE event split across two network reads, or several in one read → each event delivered once, whole (test in Task 3).
2. Candidate refreshes the room mid-session → the panel finds the active session and its history (`current` endpoint, tests in Task 1 and Task 3).
3. The interviewer tries to send, or a candidate of another interview reads → 403/404, never the conversation (tests in Task 1).
4. Candidate sends while a reply streams → input disabled; a 409 shows its message (test in Task 3, view in Task 4).
5. Report `pending` too long or `failed` → polling stops, "Check again" shown, on both screens (browser check in Task 5).

---

### Task 1: Backend — AI routes in the interview, for candidate and owner

**Files:**
- Modify: `backend/src/app.js` (mount `routers.practice` at `/api/interviews/:id/ai` in `MOUNTS`, before `interviews`; remove the `/api/practice` mount)
- Modify: `backend/src/routes/practice.routes.js` (`express.Router({ mergeParams: true })`; drop `/run`)
- Modify: `backend/src/services/practice.service.js` (every method takes `(principal, interviewId, …)`; access rules; add `current`; drop `run`)
- Modify: `backend/src/controllers/practice.controller.js` (pass `req.params.id`)
- Modify: `backend/src/repositories/practiceSession.repository.js` (add `findActive`; `startExclusive` without `since`)
- Modify: `backend/src/validators/practice.schemas.js` (`practiceSessionParams` gets `id`)
- Modify: `backend/src/container.js` (practice service needs no `codeService`)
- Modify: `docs/superpowers/specs/2026-11-22-practice-interviewer-design.md` (add a "Révision du 22/11" section with the three decisions above)
- Test: `backend/src/tests/services/practice.service.test.js`, `backend/src/tests/http/practice.test.js`, `backend/src/tests/repositories/practiceSession.repository.test.js`

**Interfaces:**
- Produces (all `→ JSON` unless SSE), `:id` = interview id:

| Route | Who | Answer |
|---|---|---|
| `POST /api/interviews/:id/ai/sessions` `{ language }` | candidate | `201 { id, status, language, startedAt }` |
| `GET /api/interviews/:id/ai/sessions/current` | candidate, owner | `200 { sessionId: string \| null }` |
| `GET /api/interviews/:id/ai/sessions/:sid` | candidate, owner | `200 { id, status, language, code, startedAt, finishedAt, messages, reportStatus, report }` |
| `POST /api/interviews/:id/ai/sessions/:sid/messages` `{ text, code, language }` | candidate | SSE |
| `POST /api/interviews/:id/ai/sessions/:sid/finish` | candidate, owner | `200 { status: "finished" }` |

- `practiceService.{ start, current, get, streamMessage, finish }(principal, interviewId, …)`.
- Rate-limit key for messages: `ai:<interviewId>`.

- [ ] **Step 1: Write the failing tests** (HTTP, through `buildTestApp` with `candidateOf("iv-1")`, `ada` (owner of iv-1), `bob`):
```js
it("lets the invited candidate start and chat", async () => { /* POST /api/interviews/iv-1/ai/sessions as candidateOf("iv-1") → 201; messages → 200 text/event-stream */ });
it("lets the owner read the session, report included, but not send or start", async () => {
  // ada: GET /api/interviews/iv-1/ai/sessions/s1 → 200 with messages + report (reportStatus "ready")
  // ada: POST …/sessions → 403 ; POST …/sessions/s1/messages → 403
});
it("hides the AI of an interview from everyone else", async () => {
  // bob → 404 ; candidateOf("iv-2") → 404 on GET /api/interviews/iv-1/ai/sessions/s1
});
it("GET …/sessions/current answers the active session id", async () => { /* findFirst → session() → { sessionId: "s1" } */ });
it("caps sessions per interview at 3", async () => { /* count → 3 → 409 "Practice limit reached" */ });
```
Service: `current` returns the active id; closes an over-time session and returns `null`; the owner calling `streamMessage` or `start` throws 403. Repository: `startExclusive` counts `{ where: { interviewId } }` (no date).

- [ ] **Step 2: Run them, verify they fail**

Run: `cd backend && npx vitest run src/tests/http/practice.test.js src/tests/services/practice.service.test.js src/tests/repositories/practiceSession.repository.test.js`
Expected: FAIL — 404 on the new paths, `service.current is not a function`.

- [ ] **Step 3: Implement**

Access helper in the service: `assertAccess(principal, interviewId, { write })` — candidate: `principal.interviewId === interviewId` else 404; owner: `interviewRepository.findById(interviewId)`, `interviewerId === principal.userId` else 404; `write` and not candidate → `AppError(403, "Only the candidate talks to the AI interviewer")`. A session whose `interviewId` differs from `:id` → 404. Owners allowed by the route are `INTERVIEWER`, `DEMO`, `CANDIDATE` (`requireKind` on the router).

- [ ] **Step 4: Run the backend suite** — `cd backend && npm test` → green (the old `/api/practice` tests are rewritten or removed in this task, not skipped).

- [ ] **Step 5: Commit** — `git commit -m "feat(ai): AI interviewer routes in the interview room — candidate chats, owner reads"`

---

### Task 2: Backend — remove the practice link

**Files:**
- Delete: `backend/src/tests/http/practiceLink.test.js`
- Modify: `auth/principal.js` (drop `PRACTICE`), `auth/identityResolver.js` (drop `fromPracticeRequest`, `PRACTICE_LINK_TTL_MS`, `now` if unused), `auth/middleware.js` (drop `authenticatePractice`), `shared/rateKeys.js` (drop the practice branch), `services/interview.service.js` (drop `createPracticeLink`, `practiceUsage`, `demoPracticeLimiter`, `practiceSessionRepository`), `controllers/interview.controller.js`, `routes/interview.routes.js`, `repositories/interview.repository.js` (drop `findByPracticeHash`, `setPracticeHash`), `shared/mongoShape.js` (drop `practiceTokenHash`), `container.js` (drop `DEMO_PRACTICE_LINKS_PER_HOUR`), `tests/helpers/testApp.js` (drop `practiceOf`, `fromPracticeRequest`), `auth/identity.test.js`, `tests/http/auth.test.js`, `tests/http/interviews.test.js`, `tests/http/code.test.js`
- Modify: `backend/prisma/schema.prisma` (drop `practiceTokenHash`, `practiceCreatedAt`)
- Create: `backend/prisma/migrations/20261122180000_drop_practice_link/migration.sql`
- Modify: `CLAUDE.md` (principal table: remove the `practice` row; § AI practice: new routes, candidate + owner access; candidate row: may use `/api/interviews/:id/ai/*`)

- [ ] **Step 1: Make the guard fail first** — in `tests/http/auth.test.js` replace the practice-token tests with: `x-practice-token` alone on `GET /api/interviews/iv-1/ai/sessions/current` → **401**. Run `cd backend && npx vitest run src/tests/http/auth.test.js` → FAIL until the mount and resolver are gone (it currently isn't a route at all → adjust to the expected failure you see, then make it pass).
- [ ] **Step 2: Remove the code and tests listed above.** `migration.sql`: `DROP INDEX IF EXISTS "interviews_practiceTokenHash_key"; ALTER TABLE "interviews" DROP COLUMN IF EXISTS "practiceTokenHash", DROP COLUMN IF EXISTS "practiceCreatedAt";` (check the real index and table names in `20261122120000_practice/migration.sql` first).
- [ ] **Step 3: Verify** — `cd backend && npm test` → green; `grep -rn "practiceToken\|PRACTICE\b\|fromPracticeRequest\|authenticatePractice" src` → nothing. Apply with `npx prisma migrate deploy` then `npx prisma generate` (stop the dev server first; never `migrate reset`, never `npm run seed`).
- [ ] **Step 4: Commit** — `git commit -m "refactor(ai): drop the separate practice link — the invite link opens the AI too"`

---

### Task 3: Frontend — AI interviewer API client, SSE parser, chat reducer (with Vitest)

**Files:**
- Modify: `frontend/package.json` (devDependency `vitest` `^4.1.10`, script `"test": "vitest run"`)
- Create: `frontend/src/lib/sse.ts`, `frontend/src/lib/aiInterviewer.ts`, `frontend/src/lib/aiChat.ts`
- Test: `frontend/src/lib/sse.test.ts`, `frontend/src/lib/aiInterviewer.test.ts`, `frontend/src/lib/aiChat.test.ts`

**Interfaces:**
- Consumes: Task 1 routes; `ApiFetch` from `lib/api.ts` (the rooms' existing `apiFetch` already carries the invite or the Clerk/demo token).
- Produces:
  - `createSseParser(onEvent: (e: { event: string; data: unknown }) => void): (chunk: string) => void`
  - Types: `AiMessage { role: 'candidate' | 'interviewer'; text }`; `AiReport` (mirror of the backend `PracticeReportSchema`: `summary`, `strengths[]`, `improvements[]`, `testsRun[{ runId, input, expected, actual, passed }]`, `complexity { time, space, comment }`, `nextSteps[]`); `ReportStatus = 'none' | 'pending' | 'ready' | 'failed'`; `AiSession { id; status: 'active' | 'finished'; language; code: string | null; startedAt; finishedAt: string | null; messages: AiMessage[]; reportStatus; report: AiReport | null }`; `TurnEvent = { type: 'token'; text } | { type: 'tool'; name } | { type: 'done'; ended; limited } | { type: 'error'; message }`.
  - `class AiApiError extends Error { status: number; retryAfter?: number }` (message = backend `message`).
  - `createAiInterviewerApi(apiFetch: ApiFetch, interviewId: string)` → `{ current(): Promise<string | null>; start(language): Promise<string>; get(sid): Promise<AiSession>; send(sid, { text, code, language }, onEvent: (e: TurnEvent) => void, signal?: AbortSignal): Promise<void>; finish(sid): Promise<void> }` — non-2xx throws `AiApiError`.
  - `type ChatState = { messages: AiMessage[]; open: boolean }`; `addCandidateMessage(state, text): ChatState`; `applyTurnEvent(state, event): ChatState`.

- [ ] **Step 1: Write the failing tests**

`sse.test.ts`:
```ts
it('delivers an event split across two chunks once, whole', () => {
  const got: unknown[] = []; const feed = createSseParser((e) => got.push(e));
  feed('event: token\ndata: {"te'); feed('xt":"Hi"}\n\n');
  expect(got).toEqual([{ event: 'token', data: { text: 'Hi' } }]);
});
it('delivers several events from one chunk, in order', () => {
  const got: { event: string }[] = []; const feed = createSseParser((e) => got.push(e));
  feed('event: token\ndata: {"text":"a"}\n\nevent: done\ndata: {"ended":false,"limited":false}\n\n');
  expect(got.map((e) => e.event)).toEqual(['token', 'done']);
});
```
`aiInterviewer.test.ts` (fake `apiFetch` returning `new Response(...)`; streamed body from a `ReadableStream` enqueuing two chunks):
```ts
it('send posts to the interview and turns the SSE body into TurnEvents', async () => {
  // path '/api/interviews/iv-1/ai/sessions/s1/messages', body JSON {text,code,language}
  expect(events).toEqual([{ type: 'token', text: 'Hel' }, { type: 'token', text: 'lo' }, { type: 'done', ended: false, limited: false }]);
});
it('send throws the refusal before any event', async () => {
  // 409 { message: 'A reply is still being written' } → rejects { status: 409, message }, onEvent never called
});
it('current returns the active session id or null', async () => { /* { sessionId: 's1' } → 's1'; { sessionId: null } → null */ });
it('a 429 carries retryAfter', async () => { /* start → 429 { message, retryAfter: 12 } → error.retryAfter === 12 */ });
```
`aiChat.test.ts`:
```ts
it('appends tokens to the open interviewer message', () => {
  let s = addCandidateMessage({ messages: [], open: false }, 'hi');
  s = applyTurnEvent(s, { type: 'token', text: 'Hel' }); s = applyTurnEvent(s, { type: 'token', text: 'lo' });
  expect(s.messages).toEqual([{ role: 'candidate', text: 'hi' }, { role: 'interviewer', text: 'Hello' }]);
});
it('starts a new interviewer message after a tool call', () => {
  // token "Let me run it." → tool run_code → token "It works." ⇒ two interviewer messages
});
```
- [ ] **Step 2: Run them, verify they fail** — `cd frontend && npm install -D vitest@^4.1.10 && npm test` → FAIL, modules not found.
- [ ] **Step 3: Implement.** Parser: string buffer, split on `\n\n`, read `event:` and joined `data:` lines, `JSON.parse`, keep the incomplete tail. `send`: non-OK → read JSON, throw; else `res.body.pipeThrough(new TextDecoderStream())`, feed chunks, map to `TurnEvent`.
- [ ] **Step 4: Verify** — `cd frontend && npm test && npm run build && npm run lint` → clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(ai-ui): AI interviewer API client with SSE streaming and chat reducer"`

---

### Task 4: Frontend — the AI panel in both rooms

**Files:**
- Create: `frontend/src/components/ai/AiInterviewerPanel.tsx`, `frontend/src/components/ai/AiReport.tsx`, `frontend/src/lib/useAiInterviewer.ts`
- Modify: `frontend/src/components/CollaborativeEditor.tsx` (optional prop `onCodeChange?: (code: string, language: string) => void`, called on local edits, remote `code-update`, and language changes)
- Modify: `frontend/src/pages/CandidateRoom.tsx`, `frontend/src/pages/InterviewRoom.tsx` (keep the latest code in a ref via `onCodeChange`; render the panel to the right of the editor in the Code tab, with a toggle button "AI interviewer" in the tab bar)

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `useAiInterviewer({ apiFetch, interviewId, role: 'candidate' | 'interviewer' })` → `{ phase: 'loading' | 'idle' | 'active' | 'finished'; messages: AiMessage[]; replying: boolean; error: string | null; session: AiSession | null; start(language): Promise<void>; send(text, code, language): Promise<void>; finish(): Promise<void>; checkReport(): Promise<void> }`
  - `AiInterviewerPanel({ apiFetch, interviewId, role, getCode: () => { code: string; language: string } })`
  - `AiReport({ status, report, onCheckAgain })`

Hook rules:
- Mount: `current()` → id → `get(id)` → `active` / `finished`; `null` → `idle`. Errors → `error`, `idle`.
- Candidate: `start(language)` (the editor's current language) → `active`; 409 "Practice limit reached" → `error` with that message. `send`: `addCandidateMessage`, `replying = true`, events through `applyTurnEvent`; `done.ended` → `finished`; `error` event / `AiApiError` → `error` (409 "Session time is over" → `finished`). One `AbortController` per turn, aborted on unmount.
- Interviewer: no `start`/`send` in the view. While `idle` or `active`, poll `current()` + `get()` every 3000 ms and replace `messages` with the server's; stop on unmount.
- Both: `finished` with `reportStatus` `pending` → `get` every 3000 ms, at most 40 times, then stop (`checkReport` restarts it).

View:
- Candidate, `idle`: the notice (Global Constraints) + "Start AI interviewer". `active`: messages, textarea (Enter sends, Shift+Enter new line, disabled while `replying`), "The interviewer is thinking…", "End". `finished`: `AiReport`.
- Interviewer: same messages read-only, header "AI interviewer — candidate's session", "End session" while `active`, `AiReport` when finished, "The candidate hasn't started the AI interviewer" when `idle`.
- Style of the rooms: `bg-slate-900`/`#1e1e1e` panels, `brand` accents, lucide icons (`Bot`).

- [ ] **Step 1: Implement** the hook, the two components and the room changes to the interfaces above.
- [ ] **Step 2: Verify** — `cd frontend && npm test && npm run build && npm run lint` → clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(ai-ui): AI interviewer panel in the interview room — candidate chats, interviewer follows"`

---

### Task 5: End-to-end check in the browser and docs

**Files:**
- Modify: `CLAUDE.md` (frontend `npm test`; the AI panel in both rooms; the new routes, if not already done in Task 2)

- [ ] **Step 1: Run it for real** — Docker up, backend and frontend dev servers (ask the user before restarting the backend). Demo mode ("Continue as Guest") → open an interview → "Invite candidate" → open the copied link in another window. Check:
  1. Candidate: notice visible; "Start AI interviewer" → a problem is presented, text streams.
  2. Candidate codes; asks "is my code right?" → the AI reads/runs it (code from the shared editor).
  3. Interviewer window: the conversation appears within ~3 s; no input box.
  4. Candidate sends while a reply streams: input disabled.
  5. Candidate refreshes mid-session: same session, history back.
  6. "End" → report pending → ready, on **both** windows, with real tests.
  7. Report `failed` / slow: "Check again" appears, polling has stopped (Review Focus 5).
  Uses the OpenAI key from the user's `.env` — a few cents per session.
- [ ] **Step 2: Commit docs** — `git commit -m "docs: AI interviewer in the room"`
