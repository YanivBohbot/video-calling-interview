# Avatar interviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the human interviewer is absent and the interview allows it, the invited candidate runs the interview with a LiveAvatar avatar driven by our existing interviewer agent (voice in, voice out), and the interviewer gets the transcript and report.

**Architecture:** LiveAvatar (FULL mode, no persona context) is only a browser device: its `user.transcription` events feed the existing `POST …/ai/sessions/:sid/messages` turn, and the agent's reply is spoken with `session.repeat(text)`. Backend adds interview fields, an owner-presence map shared with realtime (like `roomQuestions`), a session `mode`, an avatar-token endpoint (LiveAvatar client in `integrations/`), a `present_question` tool and an avatar prompt.

**Tech Stack:** Express 5 ESM, Prisma/Postgres, Socket.io, langchain 1.5 (`createAgent`), React 19 + Vite + TS, `@heygen/liveavatar-web-sdk@0.0.20`, vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-11-24-avatar-interviewer-design.md`

## Global Constraints

- Commit messages: **no** `Co-Authored-By: Claude` / `Claude-Session` lines (user rule).
- `LIVEAVATAR_API_KEY` never leaves the backend; the browser only gets a session token.
- Token request body: `{ mode: "FULL", avatar_id, is_sandbox, max_session_duration, avatar_persona: { language } }` — **no** `context_id` (the avatar must never answer by itself).
- Defaults: `LIVEAVATAR_AVATAR_ID` = `dd73ea75-1218-4ef3-92ce-606d5f7fbc0a` (Wayne), `LIVEAVATAR_SANDBOX` = `true`.
- Interview fields: `company` (`""`), `aiInterviewerEnabled` (`false`), `interviewLanguage` (`"en"`, one of `en` | `he`).
- One AI session per interview (unchanged); `mode` is `"text"` (default) or `"avatar"`, fixed at start.
- Avatar tokens per session ≤ 10. Follow-ups per behavioral question ≤ 2 (prompt rule).
- Avatar start refused unless: `aiInterviewerEnabled`, ≥ 1 question, no owner in the room, LiveAvatar configured.
- `src/ai/` rules hold: agents never import `integrations/`, Prisma or `process.env` (aiWiring test).
- The candidate never receives questions other than the one presented, never sources, never the report.

## Review Focus

- A candidate opening the text panel when avatar mode is on offer: it must start an **avatar** session (one session per interview), not burn it as text.
- Two transcriptions arriving while the agent replies: sent as **one** message after the reply, never a second concurrent turn (backend answers 409).
- Owner joins then leaves while the candidate waits: the start card must reappear (presence `false` again), and a second owner tab leaving must not mark the owner absent while one tab remains (count, not boolean).
- Avatar connection drops mid-session: the candidate can resume with a new token while the AI session is active, up to 10; past that, a clear error and the typed fallback still works.
- Behavioral-only interview (no code written): the coach must still write a report (no `run_code` requirement).

---

### Task 1: Interview fields + session mode (DB, validation, shaping)

**Files:**
- Modify: `backend/prisma/schema.prisma` (Interview: `company`, `aiInterviewerEnabled`, `interviewLanguage`; AiPracticeSession: `mode String @default("text")`, `presentedIndex Int?`, `avatarTokens Int @default(0)`), new migration via `npm run db:migrate -- --name avatar_interviewer`
- Modify: `backend/src/validators/interview.schemas.js`, `backend/src/services/interview.service.js` (create + update), `backend/src/controllers/interview.controller.js` (`toCandidateRoomDoc`)
- Test: `backend/src/tests/http/interviews.test.js` (extend)

**Interfaces:**
- Produces: interview docs carry `company`, `aiInterviewerEnabled`, `interviewLanguage`; candidate room doc carries `company`, `interviewLanguage`, `aiInterviewerEnabled`, `questionCount` (number, never the questions).

- [ ] **Step 1: Failing tests** in `interviews.test.js`:
  - `POST /api/interviews` with `{ …required, company: "Acme", aiInterviewerEnabled: true, interviewLanguage: "he" }` → repository `create` receives those three; without them → `company: ""`, `aiInterviewerEnabled: false`, `interviewLanguage: "en"`.
  - `interviewLanguage: "fr"` → 400 `"Invalid interviewLanguage"`; `aiInterviewerEnabled: "yes"` → 400 `"Invalid aiInterviewerEnabled"`.
  - `PATCH /api/interviews/:id` accepts the three fields.
  - `GET /api/interviews/:id/room` as candidate → body has `company`, `interviewLanguage`, `aiInterviewerEnabled`, `questionCount: 2` (interview with 2 questions) and **no** `questions` key.
- [ ] **Step 2:** `npx vitest run src/tests/http/interviews.test.js` → FAIL on the new cases.
- [ ] **Step 3:** Schema + migration; zod: `company: optionalString("Invalid company")`, `aiInterviewerEnabled: z.boolean({ invalid_type_error: "Invalid aiInterviewerEnabled" }).optional()`, `interviewLanguage: z.enum(["en","he"], { errorMap: () => ({ message: "Invalid interviewLanguage" }) }).optional()` on create and update; service passes them with the defaults above; `toCandidateRoomDoc` adds the four fields.
- [ ] **Step 4:** Same vitest run → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(interviews): company, language and AI-interviewer opt-in`.

### Task 2: Owner presence in the room

**Files:**
- Create: `backend/src/realtime/roomOwners.js` (`addOwner(map, roomId)`, `removeOwner(map, roomId)` → returns the new count; `isOwnerPresent(map, roomId)`)
- Modify: `backend/src/realtime/handlers/joinRoom.js`, `handlers/disconnect.js`, `realtime/index.js` (accept `roomOwners = new Map()`), `backend/src/container.js` (one `roomOwners` Map, exposed as `container.realtime.roomOwners`, passed to `createPracticeService` as `isInterviewerPresent: (id) => isOwnerPresent(roomOwners, id)`), `backend/src/server.js` (pass `roomOwners` to `attachRealtime` like `roomQuestions`)
- Test: `backend/src/realtime/roomOwners.test.js`, extend `backend/src/realtime/handlers.test.js`

**Interfaces:**
- Produces: socket event `interviewer-presence` payload `{ present: boolean }` — sent to the joining socket on `join-room`, and to the whole room when the owner count goes 0→1 or 1→0. `isInterviewerPresent(interviewId): boolean` for Task 4.

- [ ] **Step 1: Failing tests:** `roomOwners.test.js` — add twice + remove once → present; remove again → absent; remove on unknown room → 0, no negative. `handlers.test.js` — owner joins → room gets `["room:r1","interviewer-presence",{present:true}]`; candidate joins → candidate socket gets `interviewer-presence {present:true}` only; second owner socket joins → no extra room emit; owner socket disconnects while another owner socket remains → no emit; last owner disconnects → room gets `{present:false}`.
- [ ] **Step 2:** `npx vitest run src/realtime` → FAIL.
- [ ] **Step 3:** Implement; owner = `isOwnerKind(socket.data.principal)`; remember on `socket.data.isOwner` so `disconnect` decrements only owner sockets that joined.
- [ ] **Step 4:** `npx vitest run src/realtime` → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(realtime): tell the room whether the interviewer is there`.

### Task 3: LiveAvatar token client + config

**Files:**
- Create: `backend/src/integrations/liveavatar/client.js`
- Modify: `backend/src/config/env.js` (`LIVEAVATAR_API_KEY` optional, `LIVEAVATAR_AVATAR_ID` default Wayne id, `LIVEAVATAR_SANDBOX` boolean default true → `config.liveAvatar = { apiKey, avatarId, sandbox }`), `backend/.env.example`
- Test: `backend/src/tests/integrations/liveavatar/client.test.js`

**Interfaces:**
- Produces: `createLiveAvatarClient({ apiKey, avatarId, sandbox, fetch = globalThis.fetch })` → `{ createSessionToken({ language, maxSeconds }) → Promise<{ sessionToken: string }> }`; throws `UpstreamError("Avatar service unavailable")` on non-2xx / missing token. `apiKey` absent → `createLiveAvatarClient` returns `null`.

- [ ] **Step 1: Failing tests:** fake `fetch` records the call: URL `https://api.liveavatar.com/v1/sessions/token`, header `X-API-KEY`, JSON body exactly `{ mode: "FULL", avatar_id, is_sandbox: true, max_session_duration: 600, avatar_persona: { language: "he" } }` for `createSessionToken({ language: "he", maxSeconds: 600 })`; response `{ data: { session_token: "t" } }` → `{ sessionToken: "t" }`; 401 → `UpstreamError`; no key → `null`. Config test (extend `config/env` test if present): blank `LIVEAVATAR_API_KEY` → `apiKey: undefined`; `LIVEAVATAR_SANDBOX=false` → `false`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm test` → all pass.
- [ ] **Step 5:** Tell the user to rename their `.env` line to `LIVEAVATAR_API_KEY=` (no spaces, no quotes). Commit `feat(integrations): LiveAvatar session-token client`.

### Task 4: Avatar sessions in the practice service

**Files:**
- Modify: `backend/src/services/practice.service.js`, `backend/src/repositories/practiceSession.repository.js` (`startExclusive` takes `mode`; `claimAvatarToken(id, { max })` atomic like `claimMessage`; `savePresentedIndex(id, index)`), `backend/src/validators/practice.schemas.js` (`startPracticeBody` gets `mode: z.enum(["text","avatar"]).default("text")`), `backend/src/controllers/practice.controller.js`, `backend/src/routes/practice.routes.js` (`POST /sessions/:sid/avatar-token`), `backend/src/container.js` (inject `liveAvatar` client and `isInterviewerPresent`)
- Test: `backend/src/tests/http/practice.test.js` (extend)

**Interfaces:**
- Consumes: `isInterviewerPresent` (Task 2), `liveAvatar.createSessionToken` (Task 3), interview fields (Task 1).
- Produces:
  - `start(principal, id, { language, mode })` — avatar refusals: not enabled → 403 `"The AI interviewer is not enabled for this interview"`; no questions → 409 `"This interview has no questions yet"`; owner present → 409 `"Your interviewer is in the room"`; no client → 503 `"The avatar is unavailable"`.
  - `avatarToken(principal, id, sid)` → `{ sessionToken, language }`; candidate only; session active + `mode === "avatar"`, else 409 `"Not an avatar session"`; 11th call → 409 `"Avatar reconnect limit reached"`; `maxSeconds` = remaining session time (≥ 60).
  - `get()` adds `mode` and, for avatar sessions, `presentedQuestion: { index, text, category, difficulty } | null`.
  - `streamMessage` passes `mode`, `company`, `interviewLanguage`, `questions` (text/category/difficulty only) to `interviewer.streamTurn`; on an event `{ type: "question", index }` calls `savePresentedIndex` and yields it.

- [ ] **Step 1: Failing tests** for each refusal above, the happy start (`mode: "avatar"` stored), token happy path (fake client gets `language: "he"` and `maxSeconds`), 10-token limit, candidate `get` shows `presentedQuestion` after a fake `question` event, owner `get` still reports, text start unchanged.
- [ ] **Step 2:** `npx vitest run src/tests/http/practice.test.js` → FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(practice): avatar-mode sessions and avatar tokens`.

### Task 5: Interviewer agent — avatar mode

**Files:**
- Create: `backend/src/ai/tools/presentQuestion.js` (export `PRESENT_QUESTION_TOOL = "present_question"`, `createPresentQuestionTool()`), add to `ai/tools/index.js`
- Modify: `backend/src/ai/prompts/interviewer.js` (`buildAvatarInterviewerPrompt({ role, company, interviewLanguage, questions })`), `ai/prompts/index.js`, `backend/src/ai/agents/interviewer/agent.js` (context schema + prompt choice by `mode`, tool registered), `ai/agents/interviewer/events.js` (`{ type: "question", index }` from a `present_question` tool message), `ai/README.md` (tool table)
- Test: `backend/src/tests/ai/tools/presentQuestion.test.js`, extend `tests/ai/prompts/interviewer.test.js`, `tests/ai/agents/interviewer/agent.test.js`

**Interfaces:**
- Produces: tool `present_question({ index: int ≥ 0 })` reads `runtime.context.questions`; out of range → `"No question at that index"`; `mode !== "avatar"` → `"Not available in this session"`; else returns `JSON.stringify({ index, text })`. Event `{ type: "question", index }`.
- Prompt rules (avatar): greet with candidate-facing role and `company`, say how many questions; questions in the given order; call `present_question` before asking each one; behavioral/system-design: ask, listen, ≤ 2 follow-ups, move on; technical: read the statement, say the editor is open, use `read_candidate_code`/`run_code`; plain spoken sentences (no markdown, no code blocks, no lists), ≤ 3 sentences per reply; speak `interviewLanguage` (`he` → Hebrew); `end_session` after the last question.

- [ ] **Step 1: Failing tests:** tool cases above; prompt contains `company`, the question count, "present_question", and "Hebrew" when `he`; agent with `fakeModel()` scripted to call `present_question({index:1})` then answer → `streamTurn` yields `{type:"question", index:1}` before `done`; text mode prompt unchanged (existing test still green).
- [ ] **Step 2:** `npx vitest run src/tests/ai` → FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm test` → all pass (aiWiring: tool file has one `tool(` and described fields).
- [ ] **Step 5:** Commit `feat(ai): interviewer agent runs avatar interviews (present_question)`.

### Task 6: Coach covers behavioral answers

**Files:**
- Modify: `backend/src/ai/agents/coach/agent.js` (`requireToolBeforeResponse` only when `code.trim()`), `backend/src/ai/prompts/coach.js` (behavioral section: structure, concrete examples, what was missing; "if no code was written, do not call run_code and leave testsRun empty")
- Test: `backend/src/tests/ai/agents/coach/agent.test.js`

- [ ] **Step 1: Failing test:** `review({ transcript: [behavioral exchange], code: "", language: "javascript" })` with `fakeModel()` answering the structured report directly → returns a report with `testsRun: []` (today it is blocked by the middleware).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(ai): the coach reports on behavioral answers too`.

### Task 7: Creation form fields

**Files:**
- Modify: `frontend/src/pages/NewInterview.tsx` (company input, language select English / עברית, checkbox "The AI interviewer may run this interview if I'm not there", off), the interview TS type wherever `interviewType` is typed (`frontend/src/lib/` or page-local)

- [ ] **Step 1:** Add the fields to `formData` and the POST body.
- [ ] **Step 2:** `npm run build` → exit 0; `npm test` → pass.
- [ ] **Step 3:** Commit `feat(interviews): company, language and AI opt-in on the creation form`.

### Task 8: Avatar interviewer in the candidate room

**Files:**
- Create: `frontend/src/lib/avatarTurns.ts` (pure: `createTurnQueue()` → `{ heard(text), replyStarted(), replyEnded() → string | null }` — merges transcriptions heard while busy into one message), `frontend/src/lib/useAvatarInterviewer.ts`, `frontend/src/components/ai/AvatarInterviewer.tsx`
- Modify: `frontend/src/lib/aiInterviewer.ts` (`start(language, mode)`, `avatarToken(sid)`, `question` TurnEvent, `AiSession.mode` / `presentedQuestion`), `frontend/src/components/CollaborativeEditor.tsx` (`onInterviewerPresence(present)` from `interviewer-presence`), `frontend/src/pages/CandidateRoom.tsx`, `frontend/package.json` (`@heygen/liveavatar-web-sdk@0.0.20`)
- Test: `frontend/src/lib/avatarTurns.test.ts`

**Interfaces:**
- Consumes: Task 4 endpoints, Task 5 `question` event, Task 2 presence event, Task 1 room fields.
- Behaviour: card shown when `aiInterviewerEnabled && questionCount > 0 && !interviewerPresent && no session`; Start → `api.start(language, "avatar")` → `call.leave()` (Stream) → `avatarToken` → `new LiveAvatarSession(token, { voiceChat: {} })`, `attach(video)` on `session.stream_ready` → send an opening turn `"(The candidate has joined.)"`; `user.transcription` → queue → `send()`; on `done` → `session.repeat(fullReply)`; `question` event → `QuestionBanner` + `tabForQuestion`; captions (last avatar line, last heard line); "Type instead" input reusing `send`; End → `session.stop()` + `api.finish`; `session.disconnected` while AI session active → "Reconnect" button (new token); session finished by the owner (poll) → `session.stop()` + "The interviewer ended the session"; `beforeunload` → `session.stop()`. The "AI interviewer" tab toggle starts an avatar session (not text) when the card conditions hold.

- [ ] **Step 1: Failing tests** in `avatarTurns.test.ts`: idle `heard("a")` → returns `"a"` to send; while busy `heard("a")`, `heard("b")` → nothing; `replyEnded()` → `"a b"`; then idle again.
- [ ] **Step 2:** `npx vitest run src/lib/avatarTurns.test.ts` → FAIL. **Step 3:** Implement queue, hook, component, room wiring. **Step 4:** PASS; `npm test`, `npm run build` → pass.
- [ ] **Step 5:** Commit `feat(room): the candidate can run the interview with the AI avatar`.

### Task 9: Interviewer side + docs

**Files:**
- Modify: `frontend/src/components/ai/AiInterviewerPanel.tsx` (badge "Avatar interview" when `mode === "avatar"`), `frontend/src/pages/InterviewRoom.tsx` (shows company/language), `CLAUDE.md` (avatar section: endpoints, presence event, env names), `backend/src/ai/README.md`

- [ ] **Step 1:** Implement; `npm run build` (frontend), `npm test` (both) → pass.
- [ ] **Step 2:** Commit `feat(room): interviewer sees avatar sessions; docs`.

### Task 10: Live verification

- [ ] **Step 1: Hebrew check** (sandbox, free): token with `language: "he"`, `repeat("שלום, ברוכים הבאים לראיון")`; user listens and judges. Poor → keep `he` in the select but mark it "beta" in the label (ruling to ledger).
- [ ] **Step 2: E2E in Chrome** on a test interview "Avatar test (a supprimer)" with `aiInterviewerEnabled`, 1 behavioral + 1 technical question, owner absent: card → start → greeting → behavioral Q spoken → user answers by voice → follow-up → technical Q banner + editor → run code → end → owner sees transcript + report. Sandbox ends after ~1 min: use Reconnect, or `LIVEAVATAR_SANDBOX=false` for one full run on the free credits (ask the user first).
- [ ] **Step 3:** Delete the test interview; record results in the ledger.
