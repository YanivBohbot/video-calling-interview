# Stage 1b — Practice page (frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The candidate opens `/practice/:id#practice=<secret>`, starts a session, codes in Monaco while chatting with the AI interviewer (streamed answers), ends it and reads the coach's report; the interviewer gets a "Practice link" button that also shows when the link was used.

**Architecture:** Three frontend layers, like the backend: `lib/practiceApi.ts` (HTTP + SSE, no React) → `lib/usePracticeSession.ts` (state, one hook) → `components/practice/*` + `pages/PracticeRoom.tsx` (view only). Pure logic (SSE parser, chat reducer, run-result text) lives in small `lib/` files with Vitest tests; components are checked by `tsc`, `eslint` and a real browser run. One small backend addition: `GET /api/practice/sessions/current`, so a refresh or a reopened tab resumes the session instead of hitting "already active".

**Tech Stack:** React 19 + TS + Vite 7, Tailwind 4, `@monaco-editor/react`, `fetch` + `ReadableStream` for SSE (not EventSource: the stream is a POST), Vitest 4 (node environment, no jsdom). Backend: Express 5 / existing layers.

**Spec:** `docs/superpowers/specs/2026-11-22-practice-interviewer-design.md` (Étape 1 — Parcours, API). Backend contract: `CLAUDE.md` § "AI practice interviewer".

## Global Constraints

- Keep it simple (user, 2026-11-22): no new state library, no new UI library, no scaling work. One hook for the page state.
- Credential: `x-practice-token: <secret>` from the URL fragment `#practice=<secret>`; the fragment is removed from the address bar once read and the secret kept in `sessionStorage` (same as the invite, `lib/storage.ts`).
- Disclaimer shown before "Start": `You are talking to an AI interviewer. Your code and messages are sent to OpenAI.`
- UI copy in English (the app is English); the agent answers in the candidate's language on its own.
- Languages: exactly the backend's `EDITOR_LANGUAGES` — `javascript`, `typescript`, `python`, `java`, `cpp`.
- SSE events from `POST /api/practice/sessions/:sid/messages`: `token {text}`, `tool {name}`, `done {ended, limited}`, `error {message}`. Refusals arrive **before** the stream as JSON `{ message }` with status 409 / 429 (`retryAfter`) / 404 / 401.
- Never log or display the practice secret; never put it in a URL query string.
- Frontend `npm run build` (tsc + vite) and `npm run lint` stay clean; backend `npm test` stays green.

**Branch:** `feat/stage1b-practice-frontend`, created from `feat/stage1-practice`.

## Review Focus

1. An SSE event split across two network reads, or several events in one read → every event is delivered once, whole (test in Task 3).
2. Refresh or reopen the link during a session → the same session comes back with its history, not a "session already active" dead end (tests in Task 1 and Task 3).
3. Send while a reply is still streaming → the input is disabled; a 409 from the backend is shown as its message, not a crash (test in Task 3, view in Task 4).
4. The report is still `pending` after the polling window, or `failed` → polling stops and the page says so with a "Check again" button (browser check in Task 6).
5. Closing the page mid-reply → the fetch is aborted, so the backend stops the agent (hook cleanup in Task 4, browser check in Task 6).

---

### Task 1: Backend — `GET /api/practice/sessions/current`

**Files:**
- Modify: `backend/src/repositories/practiceSession.repository.js` (add `findActive`)
- Modify: `backend/src/services/practice.service.js` (add `current`)
- Modify: `backend/src/controllers/practice.controller.js`, `backend/src/routes/practice.routes.js`
- Test: `backend/src/tests/services/practice.service.test.js`, `backend/src/tests/http/practice.test.js`
- Modify: `CLAUDE.md` (route list in § AI practice)

**Interfaces:**
- Produces: `GET /api/practice/sessions/current` → `200 { sessionId: string | null }`.
- `practiceSessionRepository.findActive(interviewId) → Promise<Session | null>`
- `practiceService.current(principal) → Promise<{ sessionId: string | null }>`

- [ ] **Step 1: Write the failing tests**

Service (`practice.service.test.js`, add `findActive: vi.fn(async () => null)` to the repo fake):
```js
it("current returns the link's active session id", async () => {
  repo.findActive.mockResolvedValue(active(5));
  expect(await service.current(PRINCIPAL)).toEqual({ sessionId: "s1" });
  expect(repo.findActive).toHaveBeenCalledWith("iv-1");
});
it("current closes a session whose time is over and returns null", async () => {
  repo.findActive.mockResolvedValue(active(61));
  expect(await service.current(PRINCIPAL)).toEqual({ sessionId: null });
  expect(repo.finish).toHaveBeenCalledWith("s1");
});
it("current returns null when no session is active", async () => {
  expect(await service.current(PRINCIPAL)).toEqual({ sessionId: null });
});
```
HTTP (`practice.test.js`, `aiPracticeSession.findFirst` on the stub prisma):
```js
it("GET /sessions/current answers the active session id", async () => {
  prisma.aiPracticeSession.findFirst = vi.fn().mockResolvedValue(session());
  const res = await request(app).get("/api/practice/sessions/current").set(authAs(practiceOf("iv-1")));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ sessionId: "s1" });
  expect(prisma.aiPracticeSession.findFirst).toHaveBeenCalledWith({ where: { interviewId: "iv-1", status: "active" } });
});
```

- [ ] **Step 2: Run them, verify they fail**

Run: `cd backend && npx vitest run src/tests/services/practice.service.test.js src/tests/http/practice.test.js`
Expected: FAIL — `service.current is not a function`; the HTTP test gets 404 or the `/:sid` handler.

- [ ] **Step 3: Implement**

`findActive`: `findFirst({ where: { interviewId, status: "active" } })`. `current`: `findActive(principal.interviewId)`; none → `{ sessionId: null }`; `isOver` → `close(id)` and `{ sessionId: null }`; else `{ sessionId: id }`. Controller `current` with `handle("Error fetching practice session", …)`. Route `router.get("/sessions/current", practiceController.current)` registered **before** `/sessions/:sid`.

- [ ] **Step 4: Run the backend suite**

Run: `cd backend && npm test`
Expected: all files pass (≥ 411 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src CLAUDE.md
git commit -m "feat(practice): GET /api/practice/sessions/current so the page can resume a session"
```

---

### Task 2: Shared editor pieces — language list and run-result text

**Files:**
- Modify: `frontend/package.json` (devDependency `vitest` `^4.1.10`, script `"test": "vitest run"`)
- Create: `frontend/src/lib/editorLanguages.ts`, `frontend/src/lib/runResult.ts`
- Modify: `frontend/src/components/CollaborativeEditor.tsx` (use both; no behaviour change)
- Test: `frontend/src/lib/runResult.test.ts`

**Interfaces:**
- Produces: `EDITOR_LANGUAGES: ReadonlyArray<{ id: 'javascript' | 'typescript' | 'python' | 'java' | 'cpp'; label: string }>`; `type EditorLanguage`; `describeRunResult(status: number, data: { output?: string; timedOut?: boolean; message?: string; retryAfter?: number }): string`.
- Consumed by: `practiceApi.run` (Task 3), `PracticeEditor` (Task 4).

- [ ] **Step 1: Write the failing test** — the exact strings `CollaborativeEditor` shows today:
```ts
expect(describeRunResult(429, { retryAfter: 7 })).toBe('Too many runs — try again in 7s');
expect(describeRunResult(502, {})).toBe('The code runner is unavailable right now.');
expect(describeRunResult(400, { message: 'code is required' })).toBe('code is required');
expect(describeRunResult(400, {})).toBe('Error executing code. Please try again.');
expect(describeRunResult(200, { output: '3\n', timedOut: true })).toBe('Execution timed out.\n3\n');
expect(describeRunResult(200, { output: '' })).toBe('No output.');
```
- [ ] **Step 2: Run it, verify it fails** — `cd frontend && npm install -D vitest@^4.1.10` (add script `"test": "vitest run"`), then `npm test` → FAIL, module not found.
- [ ] **Step 3: Implement**; replace the inline `<option>`s and the status branches in `CollaborativeEditor.tsx` with them.
- [ ] **Step 4: Verify** — `cd frontend && npm test && npm run build && npm run lint` → all clean.
- [ ] **Step 5: Commit** — `git commit -m "refactor(editor): share the language list and run-result text"`

---

### Task 3: Frontend practice API client, SSE parser and chat reducer (with Vitest)

**Files:**
- Create: `frontend/src/lib/sse.ts`, `frontend/src/lib/practiceApi.ts`, `frontend/src/lib/practiceChat.ts`
- Modify: `frontend/src/lib/api.ts` (`useApi({ practice })`), `frontend/src/lib/storage.ts` (practice secret + last session id)
- Test: `frontend/src/lib/sse.test.ts`, `frontend/src/lib/practiceApi.test.ts`, `frontend/src/lib/practiceChat.test.ts`

**Interfaces:**
- Consumes: Task 1's `GET /sessions/current`; the existing `ApiFetch` type from `lib/api.ts`; Task 2's `describeRunResult`.
- Produces:
  - `createSseParser(onEvent: (e: { event: string; data: unknown }) => void): (chunk: string) => void`
  - Types in `practiceApi.ts`: `PracticeMessage { role: 'candidate' | 'interviewer'; text }`, `PracticeReport` (mirror of the backend `PracticeReportSchema`: `summary`, `strengths[]`, `improvements[]`, `testsRun[{ runId, input, expected, actual, passed }]`, `complexity { time, space, comment }`, `nextSteps[]`), `ReportStatus = 'none' | 'pending' | 'ready' | 'failed'`, `PracticeSession { id; status: 'active' | 'finished'; language; code: string | null; startedAt; finishedAt: string | null; messages: PracticeMessage[]; reportStatus; report: PracticeReport | null }`, `TurnEvent = { type: 'token'; text } | { type: 'tool'; name } | { type: 'done'; ended; limited } | { type: 'error'; message }`.
  - `class PracticeApiError extends Error { status: number; retryAfter?: number }` — message is the backend's `message`.
  - `createPracticeApi(apiFetch: ApiFetch)` → `{ current(): Promise<string | null>; start(language): Promise<string>; get(sid): Promise<PracticeSession>; send(sid, { text, code, language }, onEvent: (e: TurnEvent) => void, signal?: AbortSignal): Promise<void>; finish(sid): Promise<void>; run({ language, code }): Promise<string> }` — every non-2xx throws `PracticeApiError`; `run` returns the text to show in the console, via Task 2's `describeRunResult` (it never throws for a run refusal).
  - `type ChatState = { messages: PracticeMessage[]; open: boolean }`; `applyTurnEvent(state: ChatState, event: TurnEvent): ChatState`; `addCandidateMessage(state, text): ChatState`.
  - `useApi({ practice })` sends `x-practice-token`; `storePractice(id, secret)`, `readPractice(id)`, `storePracticeSession(id, sid | null)`, `readPracticeSession(id)`.

- [ ] **Step 1: Write the failing tests**

`sse.test.ts`:
```ts
it('delivers an event split across two chunks once, whole', () => {
  const got: unknown[] = []; const feed = createSseParser((e) => got.push(e));
  feed('event: token\ndata: {"te'); feed('xt":"Hi"}\n\n');
  expect(got).toEqual([{ event: 'token', data: { text: 'Hi' } }]);
});
it('delivers several events from one chunk, in order', () => {
  const got: unknown[] = []; const feed = createSseParser((e) => got.push(e));
  feed('event: token\ndata: {"text":"a"}\n\nevent: done\ndata: {"ended":false,"limited":false}\n\n');
  expect(got.map((e: any) => e.event)).toEqual(['token', 'done']);
});
```
`practiceApi.test.ts` (fake `apiFetch` returning `new Response(...)`; a stream body built with `new ReadableStream` that enqueues two chunks):
```ts
it('send turns the SSE body into TurnEvents', async () => { /* body: token "Hel" | "lo" then done */
  expect(events).toEqual([{ type: 'token', text: 'Hel' }, { type: 'token', text: 'lo' }, { type: 'done', ended: false, limited: false }]);
  expect(fetchCall.init.body).toBe(JSON.stringify({ text: 'hi', code: 'x', language: 'python' }));
});
it('send throws the backend refusal before any event', async () => { /* 409 { message: 'A reply is still being written' } */
  await expect(api.send('s1', body, onEvent)).rejects.toMatchObject({ status: 409, message: 'A reply is still being written' });
  expect(onEvent).not.toHaveBeenCalled();
});
it('current returns the active session id or null', async () => { /* { sessionId: 's1' } then { sessionId: null } */ });
it('a 429 carries retryAfter', async () => { /* start → 429 { message, retryAfter: 12 } → error.retryAfter === 12 */ });
```
`practiceChat.test.ts`:
```ts
it('appends tokens to the open interviewer message', () => {
  let s = addCandidateMessage({ messages: [], open: false }, 'hi');
  s = applyTurnEvent(s, { type: 'token', text: 'Hel' }); s = applyTurnEvent(s, { type: 'token', text: 'lo' });
  expect(s.messages).toEqual([{ role: 'candidate', text: 'hi' }, { role: 'interviewer', text: 'Hello' }]);
});
it('starts a new interviewer message after a tool call', () => {
  // token "Let me run it." → tool run_code → token "It works."  ⇒ two interviewer messages
});
```

- [ ] **Step 2: Run them, verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — modules `./sse`, `./practiceApi`, `./practiceChat` not found.

- [ ] **Step 3: Implement**

`createSseParser`: keep a string buffer; split on `\n\n`; for each complete block read the `event:` line and join the `data:` lines, `JSON.parse` the data; keep the incomplete tail. `send`: on non-OK, read JSON and throw; otherwise `res.body.pipeThrough(new TextDecoderStream())`, feed each chunk to the parser, map `{ event, data }` → `TurnEvent`. `useApi({ practice })`: `authHeaders` returns `{ 'x-practice-token': practice }` when set (before the invite / bearer branches); the demo `leaveDemo` on 401 must not fire for it.

- [ ] **Step 4: Run tests, build and lint**

Run: `cd frontend && npm test && npm run build && npm run lint`
Expected: tests pass; build and lint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib
git commit -m "feat(practice-ui): practice API client with SSE streaming and chat reducer"
```

---

### Task 4: The practice page — hook, components, route

**Files:**
- Create: `frontend/src/lib/usePracticeSession.ts`
- Create: `frontend/src/components/practice/PracticeEditor.tsx`, `PracticeChat.tsx`, `PracticeReport.tsx`
- Create: `frontend/src/pages/PracticeRoom.tsx`
- Modify: `frontend/src/App.tsx` (public route `/practice/:id`, next to `/room/:id`)

**Interfaces:**
- Consumes: Task 3 (`createPracticeApi`, `applyTurnEvent`, `addCandidateMessage`, storage helpers, `useApi({ practice })`), Task 2 (`EDITOR_LANGUAGES`, `EditorLanguage`).
- Produces:
  - `usePracticeSession(interviewId: string, secret: string | null)` → `{ phase: 'loading' | 'invalid' | 'intro' | 'active' | 'finished' | 'blocked'; messages: PracticeMessage[]; replying: boolean; error: string | null; session: PracticeSession | null; start(language): Promise<void>; send(text, code, language): Promise<void>; finish(): Promise<void>; checkReport(): Promise<void>; run(language, code): Promise<string> }`
  - `PracticeEditor({ code, language, onCodeChange, onLanguageChange, onRun, disabled })` — Monaco + language select + Run + output panel; no Socket.io.
  - `PracticeChat({ messages, replying, disabled, onSend })` — message list, textarea (Enter sends, Shift+Enter new line), "The interviewer is thinking…" while `replying`.
  - `PracticeReport({ status, report, onCheckAgain })` — summary, strengths, improvements, tests table (input / expected / actual / ✓✗), complexity, next steps; `pending` → spinner; `failed` or timed-out polling → message + "Check again".

Hook rules (the decisions the view must not make):
- Mount: no secret → `invalid`. `current()`: 401/404 → `invalid`; an id → `get(id)` (`active` or `finished`); `null` → the id from `readPracticeSession` if any and `get` it (shows the last report), else `intro`.
- `start`: 409 "Practice limit reached" → `blocked` with that message; other errors → `error`. Store the id with `storePracticeSession`.
- `send`: `addCandidateMessage` at once, `replying = true`, events through `applyTurnEvent`; `done.ended` → `finished`; `error` event or `PracticeApiError` → `error` = its message (409 "Session time is over" → `finished`). One `AbortController` per turn, aborted on unmount.
- `finished` with `reportStatus` `pending` → `get` every 3000 ms, at most 40 times, then stop (`checkReport` restarts it).

- [ ] **Step 1: Write the hook and components** to the interfaces above, in the existing dark style of `CandidateRoom` (`bg-slate-900`, `brand` accents, lucide icons). The intro screen shows the disclaimer (Global Constraints), a language select and "Start practice". The active screen: editor left, chat right, "End session" in the header. Reuse `FullScreenMessage`'s look for `invalid` / `blocked` (copy it locally; do not export it from `CandidateRoom`).
- [ ] **Step 2: Add the route** in `App.tsx`: `<Route path="/practice/:id" element={<PracticeRoom />} />` among the public routes. `PracticeRoom` reads the secret like `CandidateRoom.takeInviteFromUrl`, with `#practice=` and the practice storage helpers.
- [ ] **Step 3: Verify** — `cd frontend && npm test && npm run build && npm run lint` → all clean.
- [ ] **Step 4: Commit** — `git commit -m "feat(practice-ui): /practice/:id page — editor, streamed chat, report"`

---

### Task 5: Interviewer — "Practice link" button and usage

**Files:**
- Modify: `frontend/src/pages/InterviewRoom.tsx` (next to "Invite candidate")

**Interfaces:**
- Consumes: `POST /api/interviews/:id/practice` → `{ url }`; `GET /api/interviews/:id/practice` → `{ createdAt: string | null; sessions: { status; startedAt; finishedAt }[] }`.

- [ ] **Step 1: Implement** — same pattern as `createInvite`: button "Practice link" (icon `GraduationCap`) creates, copies, shows "Copied!" for 2 s; title "Create and copy an AI practice link for the candidate (valid 7 days; a new one replaces the old one)". 429 (demo budget) → show the backend `message` next to the button for 4 s. On load, `GET` the usage and show a small grey line: `Practice: not used yet` or `Practice: N session(s), last <toLocaleString of the newest startedAt>`; refresh it after creating a link. Never anything else about the sessions.
- [ ] **Step 2: Verify** — `cd frontend && npm run build && npm run lint` → clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(practice-ui): interviewer creates the practice link and sees its usage"`

---

### Task 6: End-to-end check in the browser and docs

**Files:**
- Modify: `CLAUDE.md` (frontend `npm test`; `/practice/:id` in the routing section; the practice page files)

- [ ] **Step 1: Run it for real** — backend + frontend dev servers (ask the user before restarting the backend), Docker up. Demo mode ("Continue as Guest") → open an interview → "Practice link" → open the copied link in a new tab. Check, one by one:
  1. Disclaimer visible; "Start practice" → the interviewer presents a problem, text streams in.
  2. Run in the editor prints output.
  3. Send while a reply streams: the input is disabled.
  4. Refresh mid-session: same session, history back (Review Focus 2).
  5. Close the tab mid-reply, reopen: the session works (aborted turn repaired) (Review Focus 5).
  6. "End session" → report pending → ready, with real tests (Review Focus 4: watch it stop polling).
  7. Interviewer page shows "Practice: 1 session(s), last …".
  8. A wrong secret (edit the fragment) → the invalid-link screen.
  Uses the OpenAI key from the user's `.env` — a few cents per session.
- [ ] **Step 2: Update `CLAUDE.md`** and commit — `git commit -m "docs: practice page, frontend tests"`
