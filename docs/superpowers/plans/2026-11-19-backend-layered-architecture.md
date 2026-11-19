# Backend Layered Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Express backend into routes → controller → service → repository layers wired by one composition root, without changing the HTTP/Socket.io contract.

**Architecture:** Feature modules under `src/modules/*`, plain factory functions (`createXService({ deps })`) for DI, assembled in `src/container.js`. `src/app.js` builds the Express app from the container (testable with Supertest); `src/server.js` only boots. Errors are typed `AppError`s mapped by one error handler. Migration is incremental: legacy routers stay mounted until their module replaces them, so the server works after every task.

**Tech Stack:** Node ESM, Express 5, Prisma 6 / Postgres, Socket.io 4, zod 3, Vitest 4, Supertest (new dev dep).

**Spec:** `docs/superpowers/specs/2026-11-19-backend-layered-architecture-design.md`

## Global Constraints

- No change to URLs, status codes, or success JSON shapes (`_id`, `clerkID`, nested `interviewerId` object). Error bodies keep their current `message` strings; the `error: err.message` field is dropped everywhere.
- Never read, print, or commit `.env` or any secret value. Code references env var *names* only. Logs never contain secret values.
- No route protection beyond what exists today (only `POST /api/interviews/:id/questions/generate|approve` require identity).
- No frontend changes. JavaScript ESM only (no TypeScript). No new runtime dependencies; Supertest is the only new dev dependency.
- Factories are plain functions returning objects — no classes except `Error` subclasses.
- Do not run `npm run seed` (it wipes the user's DB).
- `npm test` (run from `backend/`) is green at the end of every task.

## Review Focus

1. **Repository select drift** — a `select`/`include` changed during the move silently adds/removes fields (e.g. `codeSnapshot` leaking into the list). Pinned by contract tests asserting Prisma call args (Tasks 5–7) and the live baseline diff (Task 12).
2. **Route shadowing** — `/stats`, `/activity`, `/by-clerk/:clerkId/stats`, `/:id/questions/*` must still resolve before `/:id`. Pinned by Supertest cases in Tasks 6–8.
3. **Unexpected errors leaking details** — a Prisma exception text in a 500 body. Pinned by the `handle()` / `errorHandler` tests (Task 1) and one 500 case per module (Tasks 5–8).
4. **Rate-limit body** — `retryAfter` must survive the error-handler rewrite (frontend reads `body.retryAfter`). Pinned in Task 8.
5. **Rejoin replay order** — a rejoining socket must get `question-update` before code replay, and live state before DB snapshot. Pinned in Task 10.

---

## File map

| Path | Responsibility |
|---|---|
| `src/shared/errors.js` | `AppError` + subclasses |
| `src/shared/handle.js` | wraps a controller method; non-`AppError` → `InternalError(fallbackMessage)` |
| `src/shared/errorHandler.js` | Express error middleware + 404 |
| `src/shared/mongoShape.js` | `toDoc`, `toUserDoc`, `toInterviewDoc` (moved verbatim) |
| `src/config/env.js` | `loadConfig(env)` |
| `src/auth/clerkHeaderStrategy.js`, `src/auth/requireIdentity.js` | identity resolution |
| `src/app.js` | `createApp(container)` |
| `src/container.js` | `createContainer({ config, prisma })` |
| `src/modules/<feature>/*` | routes · controller · service · repository per feature |
| `src/realtime/*` | Socket.io wiring, handlers, room state, flush scheduler |
| `src/agents/*` | `lib/agents/**` moved as-is (Task 12) |

---

### Task 0: Baseline capture and Supertest

**Files:** Modify: `backend/package.json` (devDependency)

- [ ] **Step 1:** `cd backend && npm i -D supertest`. Expected: added to devDependencies, `npm test` still 108/108.
- [ ] **Step 2:** Ensure Postgres (`docker compose up -d` at repo root) and the current backend (`npm run dev`) are running. Do not run seed.
- [ ] **Step 3:** Pick one existing interview id, one session id and one user clerkId from the API responses themselves (`GET /api/interviews`, `/api/sessions`, `/api/users`). Save to `<scratchpad>/baseline/` one JSON file per endpoint: `/api/interviews`, `/api/interviews/stats`, `/api/interviews/activity`, `/api/interviews/<id>`, `/api/interviews?interviewerId=<clerkId>`, `/api/users`, `/api/users/by-clerk/<clerkId>`, `/api/users/by-clerk/<clerkId>/stats`, `/api/users/by-clerk/does-not-exist/stats`, `/api/sessions`, `/api/sessions/<id>`, plus status codes for `/api/interviews/does-not-exist` and `/api/sessions/does-not-exist`. Never call `/api/stream/token`. Record the ids used in `<scratchpad>/baseline/ids.txt`.
- [ ] **Step 4:** Commit `package.json`/lockfile: `chore(backend): add supertest`.

### Task 1: Errors, `handle()` and error handler

**Files:** Create `src/shared/errors.js`, `src/shared/handle.js`, `src/shared/errorHandler.js`; Test `src/shared/errors.test.js` (covers all three)

**Interfaces — Produces:**
- `class AppError extends Error { constructor(status: number, message: string, extras?: object) }` — `status`, `extras` props; `expose = true`.
- Subclasses with fixed status: `ValidationError` 400, `UnauthorizedError` 401, `NotFoundError` 404, `ConflictError` 409, `RateLimitError` 429 (`constructor(message, retryAfter)` → extras `{ retryAfter }`), `InternalError` 500 (`constructor(message, { cause })`), `UpstreamError` 502.
- `handle(fallbackMessage: string, fn: (req, res) => Promise<void>)` → Express handler; rejects with `AppError` pass through to `next`, anything else becomes `new InternalError(fallbackMessage, { cause: err })`.
- `errorHandler(err, req, res, next)` → `res.status(err.status).json({ message: err.message, ...err.extras })` for `AppError`; logs `cause` (stack) server-side for `InternalError`; any non-`AppError` → 500 `{ message: "Internal server error" }`. `notFoundHandler(req, res)` → 404 `{ message: "Not found" }`.

- [ ] **Step 1: failing tests** — `errorHandler` maps `new NotFoundError("Interview not found")` → 404 `{ message: "Interview not found" }`; `new RateLimitError("Too many AI generations, slow down", 12)` → 429 `{ message, retryAfter: 12 }`; `handle("Error fetching interviews", async () => { throw new Error("P1001 db down at 10.0.0.1") })` then errorHandler → 500 body exactly `{ message: "Error fetching interviews" }` (assert `JSON.stringify(body)` does not contain `"P1001"`); a plain `Error` reaching errorHandler → 500 `{ message: "Internal server error" }`.
- [ ] **Step 2:** `npx vitest run src/shared` → FAIL (modules missing).
- [ ] **Step 3:** Implement the three files per Interfaces.
- [ ] **Step 4:** `npx vitest run src/shared` → PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat(backend): typed errors and central error handler`.

### Task 2: `mongoShape` and config

**Files:** Create `src/shared/mongoShape.js`, `src/config/env.js`; Test `src/shared/mongoShape.test.js`, `src/config/env.test.js`

**Interfaces — Produces:**
- `toDoc(record)`, `toUserDoc(user)`, `toInterviewDoc(iv)` — bodies copied verbatim from `controllers/controller.js:6-33`.
- `loadConfig(env: Record<string,string|undefined>)` → frozen `{ port: number, clientUrl: string, databaseUrl: string, aiQuestionCount: number, openaiApiKey?: string, stream: { apiKey?: string, apiSecret?: string } }`. Required: `DATABASE_URL`, `CLIENT_URL`. Defaults: `PORT` 3000, `AI_QUESTION_COUNT` 6 (both coerced to numbers). On failure throws `Error("Invalid environment: " + names.join(", "))` where `names` are the zod `issue.path` entries only.

- [ ] **Step 1: failing tests** — `toInterviewDoc` with `interviewer` → nested `interviewerId: { _id, name, email, clerkID }` and no `interviewer`/`id` keys; without `interviewer` → `interviewerId` is the raw string; `toUserDoc` renames `clerkId`→`clerkID`. `loadConfig({ DATABASE_URL: "postgres://x", CLIENT_URL: "http://localhost:5174" })` → `port` 3000, `aiQuestionCount` 6; `loadConfig({ CLIENT_URL: "http://a", OPENAI_API_KEY: "sk-SECRETVALUE" })` throws with message containing `DATABASE_URL` and not containing `SECRETVALUE`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement. `loadConfig` must not run on import.
- [ ] **Step 4:** run → PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat(backend): mongo-shape helpers and validated config`.

### Task 3: Auth strategy

**Files:** Create `src/auth/clerkHeaderStrategy.js`, `src/auth/requireIdentity.js`; Test `src/auth/auth.test.js`

**Interfaces:**
- Consumes: a `findUserByClerkId(clerkId) → Promise<{ id, name, email, clerkId } | null>` function (provided later by `userRepository`).
- Produces: `createClerkHeaderStrategy({ findUserByClerkId })` → `{ resolveIdentity(req) → Promise<{ id, name, email, clerkID } | null> }`. Same rules as `middlewares/protectRoute.js`: `x-clerk-id` first (unknown id → throw `UnauthorizedError("Invalid clerk id")`), else `Authorization: Bearer user:<clerkId>`, else `null`.
- Produces: `requireIdentity(strategy)` → middleware: sets `req.user` or `next(new UnauthorizedError("Unauthorized"))`; strategy throwing an `AppError` is forwarded; other errors → `InternalError("Auth error")`.
- Contract note (top-of-file comment in `clerkHeaderStrategy.js`): any future OAuth strategy implements the same `resolveIdentity(req)` and is swapped in `container.js` only.

- [ ] **Step 1: failing tests** — header hit → `req.user` equals `{ id, name, email, clerkID }`; unknown header → 401 `{ message: "Invalid clerk id" }`; `Bearer user:abc` → looks up `"abc"`; no header → 401 `{ message: "Unauthorized" }`. Use a fake `findUserByClerkId` (`vi.fn()`), no `vi.mock`.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat(backend): pluggable identity strategy`.

### Task 4: `app.js`, `container.js`, slim `server.js`

**Files:** Create `src/app.js`, `src/container.js`; Modify `src/server.js`; Test `src/app.test.js`

**Interfaces — Produces:**
- `createContainer({ config, prisma })` → object; this task returns `{ config, prisma, legacyRouters: { interviews, users, sessions, stream } }` (the existing router modules). Later tasks add `repositories`, `services`, `controllers`, `routers`, `auth` keys and remove `legacyRouters` entries one by one.
- `createApp(container)` → Express app: `express.json()`, `cors({ origin: config.clientUrl, credentials: true })`, `GET /health` → 200 `{ msg: "success from backedn" }` (kept verbatim), routers under `/api/interviews|users|sessions|stream` (module router if present, else legacy), then `notFoundHandler`, `errorHandler`. No `/books`. No `listen`.
- `server.js`: `loadConfig(process.env)` (on error print message and `process.exit(1)`), `connectDB()`, `createContainer`, `createApp`, `createServer(app)`; keep the existing Socket.io block unchanged for now (moved in Task 11); listen on `config.port`; keep LeetCode warm-up and `ensureCheckpointerTables()`. Delete every `console.log` of `ENV`/`process.env`. Delete `src/lib/env.js` and its import in `routes/stream.routes.js` (stream router reads `process.env.STREAM_API_KEY/SECRET` until Task 10).

- [ ] **Step 1: failing test** — `createApp({ config: { clientUrl: "http://x" }, legacyRouters: {} , ... })` with Supertest: `GET /health` → 200 body above; `GET /books` → 404; unknown route → 404 `{ message: "Not found" }`.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm test` green.
- [ ] **Step 5:** Boot check: `npm run dev`, then `curl localhost:3001/health` → 200 and `curl localhost:3001/api/interviews` matches the baseline file byte-for-byte (`diff`). Inspect boot output: no env dump.
- [ ] **Step 6:** Commit `refactor(backend): app/container/server split, stop logging env`.

### Task 5: Sessions module

**Files:** Create `src/modules/sessions/session.repository.js`, `session.service.js`, `session.controller.js`, `session.routes.js`; Test `src/modules/sessions/sessions.test.js`; Modify `container.js`, `app.js`

**Interfaces — Produces:**
- `createSessionRepository({ prisma })` → `{ findAll(), findById(id) }` — `findAll` uses `orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }]`.
- `createSessionService({ sessionRepository })` → `{ listSessions(), getSession(id) }`; missing → `NotFoundError("Session not found")`.
- `createSessionController({ sessionService })` → `{ list, get }`, each wrapped in `handle("Fetch sessions failed" | "Fetch session failed", …)`, responses through `toDoc`.
- `createSessionRouter({ sessionController })` → `Router` with `GET /`, `GET /:id`.

- [ ] **Step 1: failing contract tests** (Supertest on `createApp` with a container built from real factories over a stub `prisma = { session: { findMany: vi.fn(), findUnique: vi.fn() } }`): list → 200 `[{ _id, ... }]` and `findMany` called with the exact `orderBy` above; get unknown → 404 `{ message: "Session not found" }`; `findMany` rejecting → 500 `{ message: "Fetch sessions failed" }`.
- [ ] **Step 2–4:** FAIL → implement, wire in container (remove `legacyRouters.sessions`) → PASS; `npm test` green.
- [ ] **Step 5:** Commit `refactor(backend): sessions module`.

### Task 6: Users module

**Files:** Create `src/modules/users/user.repository.js`, `user.service.js`, `user.controller.js`, `user.routes.js`; Test `src/modules/users/users.test.js`; Modify `container.js`, `app.js`

**Interfaces — Produces:**
- `createUserRepository({ prisma })` → `{ findAll(), findByClerkId(clerkId), findIdentityByClerkId(clerkId), create(data), upsertProfile(clerkId, { update, create }), upsertDemoUser(), countInterviewStats(userId) }`. Owns `USER_SELECT` (copy `controller.js:232-244`). `findIdentityByClerkId` selects `{ id, name, email, clerkId }`. `upsertDemoUser` = the `"demo"` upsert from `controller.js:66-70`. `countInterviewStats(userId)` runs the six queries of `controller.js:332-348` and returns `{ total, completed, scheduled, cancelled, live, durations: number[] }`. Prisma `P2002` → `ConflictError`.
- `createUserService({ userRepository })` → `{ listUsers(), createUser(body), getByClerkId(clerkId), updateProfile(clerkId, body), getStats(clerkId), resolveInterviewerId(raw) → Promise<string|null> }`. Rules copied from `controller.js:246-360` and `63-75`: missing name/email/clerkID → `ValidationError("Missing required user fields")`; duplicate → `ConflictError("User exists")`; update without name → `ValidationError("Name is required")`; update duplicate → `ConflictError("Email already in use")`; defaults `title/bio/phone ""`, `timezone "UTC"`, email `${clerkId}@talentiq.dev`; unknown user stats → zeros object; `avgDuration` = rounded mean with `duration || 60`.
- Controller fallback messages: `"Fetch users failed"`, `"Create user failed"`, `"Fetch user failed"`, `"Update failed"`, `"Stats failed"`. Router order: `GET /`, `POST /`, `GET /by-clerk/:clerkId`, `PUT /by-clerk/:clerkId`, `GET /by-clerk/:clerkId/stats`.
- Container: `auth.strategy = createClerkHeaderStrategy({ findUserByClerkId: userRepository.findIdentityByClerkId })`.

- [ ] **Step 1: failing tests** — service unit tests with a fake repository object for every rule above (including `resolveInterviewerId("demo")` calls `upsertDemoUser` and returns its id; unknown → `null`). Supertest contract: `GET /api/users/by-clerk/x/stats` for unknown user → 200 `{ total: 0, completed: 0, scheduled: 0, cancelled: 0, live: 0, avgDuration: 0 }`; `POST /` with Prisma rejecting `{ code: "P2002" }` → 409 `{ message: "User exists" }`; `GET /` asserts `findMany` called with `{ orderBy: { createdAt: "desc" }, select: USER_SELECT }` and body uses `_id`/`clerkID`.
- [ ] **Step 2–4:** FAIL → implement, remove `legacyRouters.users` → PASS; `npm test` green.
- [ ] **Step 5:** Commit `refactor(backend): users module`.

### Task 7: Question validation + interviews module

**Files:** Create `src/modules/questions/question.validation.js`, `src/modules/interviews/interview.repository.js`, `interview.service.js`, `interview.controller.js`, `interview.routes.js`; Move test `src/controllers/controller.test.js` → `src/modules/questions/question.validation.test.js` (drop its `vi.mock`, import from the new file, assertions unchanged); Test `src/modules/interviews/interviews.test.js`; Modify `container.js`, `app.js`, `src/controllers/aiController.js` (import `validateQuestionsPayload`, `toInterviewDoc`, `INTERVIEWER_SELECT` from their new homes until Task 8)

**Interfaces — Produces:**
- `validateQuestionsPayload(questions) → string | null` — moved verbatim with its constants from `controller.js:175-201`.
- `createInterviewRepository({ prisma })` → `{ findMany(where), findById(id), findByIdWithInterviewer(id), create(data), updateStatus(id, status), update(id, data), delete(id), countDashboardStats(), findRecent(take), findCodeSnapshot(id) }`. Owns `INTERVIEWER_SELECT` (exported) and `INTERVIEW_LIST_SELECT` (copy `controller.js:37-61`). `updateStatus` has **no include** (returns raw `interviewerId` string); `create`/`update`/`findByIdWithInterviewer` include `interviewer: { select: INTERVIEWER_SELECT }`. `findMany` uses `orderBy: { scheduledAt: "asc" }`, `select: INTERVIEW_LIST_SELECT`. `P2025` → `NotFoundError("Interview not found")`. `findCodeSnapshot(id)` selects `{ codeSnapshot, codeLanguage }`.
- `createInterviewService({ interviewRepository, resolveInterviewerId })` → `{ list({ rawInterviewer }), create({ rawInterviewer, body }), get(id), updateStatus(id, status), update(id, body), remove(id), dashboardStats(), recentActivity() }`. Rules from `controller.js:79-228, 364-428`: unknown interviewer → `ValidationError("Interviewer not found")` (400, not 404); missing create fields → `ValidationError("Missing required interview fields")`; defaults duration 60, interviewType `"technical"`, notes `""`; status whitelist `["scheduled","live","completed","cancelled"]` → `ValidationError("Invalid status")`; invalid questions → `ValidationError(<validateQuestionsPayload message>)`; activity mapping copied with `interviewerName` fallback `"Unknown"`, `take: 8`.
- Controller: `rawInterviewer = req.header("x-clerk-id") || req.query.interviewerId` (list) / `|| req.body.interviewerId || req.body.interviewerClerkId` (create). Fallback messages: `"Error fetching interviews"`, `"Error creating interview"`, `"Error fetching interview"`, `"Error updating status"`, `"Error deleting interview"`, `"Error updating interview"`, `"Stats failed"`, `"Activity failed"`. Delete → 200 `{ message: "Interview deleted" }`.
- Router (questions sub-router is mounted separately in Task 8): `GET /stats`, `GET /activity`, `GET /`, `POST /`, `GET /:id`, `PATCH /:id/status`, `PATCH /:id`, `DELETE /:id`. Until Task 8, `app.js` mounts the legacy AI routes (`aiController` + `protectRoute`) at `/api/interviews/:id/questions` before this router.

- [ ] **Step 1: failing tests** — service unit tests with fakes for every rule above. Supertest contract over stub `prisma.interview`/`prisma.user`: `GET /api/interviews` asserts `findMany` args `{ where: {}, orderBy: { scheduledAt: "asc" }, select: INTERVIEW_LIST_SELECT }` and `INTERVIEW_LIST_SELECT` has no `codeSnapshot`/`questions` keys; `GET /api/interviews?interviewerId=b` with header `x-clerk-id: a` resolves `"a"`; `GET /api/interviews/stats` and `/activity` hit their handlers (not `/:id`); `PATCH /:id/status` body has `interviewerId` as a string, `PATCH /:id` has it nested; `PATCH /:id` with `{ status: "bogus" }` → 400 `{ message: "Invalid status" }`; delete of missing id (`P2025`) → 404 `{ message: "Interview not found" }`; create with unknown interviewer → 400 `{ message: "Interviewer not found" }`.
- [ ] **Step 2–4:** FAIL → implement, remove `legacyRouters.interviews` (keep the AI routes on the legacy path) → PASS; `npm test` green.
- [ ] **Step 5:** Commit `refactor(backend): interviews module and question validation`.

### Task 8: Questions (AI) module

**Files:** Create `src/modules/questions/question.service.js`, `question.controller.js`, `question.routes.js`; Move test `src/controllers/aiController.test.js` → `src/modules/questions/questions.test.js` (rewritten against factories with injected fakes; same 12 cases and expectations); Delete `src/controllers/`, `src/routes/interview.routes.js`, `src/middlewares/`; Modify `container.js`, `app.js`

**Interfaces:**
- Consumes: `interviewRepository.findById`, `findByIdWithInterviewer` (Task 7); `validateQuestionsPayload` (Task 7); `requireIdentity`, strategy (Tasks 3, 6); `startQuestionGeneration`, `resumeQuestionGeneration` and the four error classes from `lib/agents/questionGenerator/*` (unchanged).
- Produces: `createQuestionService({ interviewRepository, generation: { start, resume }, rateLimiter, config })` → `{ generate({ interviewId, identityKey }), approve({ interviewId, jobId, approved, questions }) }`. Order and outcomes copied from `aiController.js`: interview missing → `NotFoundError("Interview not found")`; `!config.openaiApiKey` → `AppError(500, "AI not configured: OPENAI_API_KEY missing")`; limiter → `RateLimitError("Too many AI generations, slow down", retryAfter)`; `count: config.aiQuestionCount`; `AIConfigError` → `AppError(500, err.message)`; `AIProviderError`/`AIInvalidResponseError` → `UpstreamError("AI service unavailable")`; bad `jobId`/`approved` types → `ValidationError("jobId (string) and approved (boolean) are required")`; approve validates questions only when `approved && questions !== undefined`; `UnknownJobError` → `NotFoundError("No pending approval for this job")`; reject → `{ status: "rejected" }` without reloading the interview; approve → reloaded interview via `findByIdWithInterviewer`, shaped with `toInterviewDoc` in the controller.
- Rate limiter instance `createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 })` is created in `container.js`; identity key `req.user?.clerkID || req.user?.id || "anon"`.
- Router: `Router({ mergeParams: true })` with `POST /generate`, `POST /approve`, both behind `requireIdentity(container.auth.strategy)`; mounted at `/api/interviews/:id/questions` before the interviews router. Fallback messages `"Failed to generate questions"`, `"Failed to resolve approval"`.

- [ ] **Step 1: failing tests** — port the 12 cases (service-level with fakes), plus Supertest: 429 body contains `retryAfter` as a number; 502 body is exactly `{ message: "AI service unavailable" }`; `POST /api/interviews/iv-1/questions/generate` without identity → 401; `approve` passes `interviewId` from the URL, never the body.
- [ ] **Step 2–4:** FAIL → implement, delete legacy files → PASS; `npm test` green; `grep -r "controllers/\|middlewares/\|routes/" src` → only matches inside `modules/`.
- [ ] **Step 5:** Commit `refactor(backend): questions module behind identity strategy`.

### Task 9: Stream module

**Files:** Create `src/modules/stream/stream.service.js`, `stream.controller.js`, `stream.routes.js`; Test `src/modules/stream/stream.test.js`; Delete `src/routes/stream.routes.js`; Modify `container.js`, `app.js`

**Interfaces — Produces:** `createStreamService({ streamClient, now = () => Date.now() })` → `{ createUserToken(userId) → string }` with `valid_until = floor(now/1000) + 3600`, `issued_at = floor(now/1000) - 60`. Container builds `new StreamClient(config.stream.apiKey, config.stream.apiSecret)` lazily on first use (so boot without Stream keys still works). Controller: missing `userId` → `ValidationError("User ID is required")`; fallback `"Internal server error"`; 200 `{ token }`. Router `GET /token`.

- [ ] **Step 1: failing tests** — fake `streamClient.generateUserToken` receives `{ user_id: "u1", valid_until, issued_at }` for a fixed `now`; missing userId → 400 `{ message: "User ID is required" }`. Use a fake token string; never a real key.
- [ ] **Step 2–4:** FAIL → implement, remove `legacyRouters` entirely → PASS; `npm test` green.
- [ ] **Step 5:** Commit `refactor(backend): stream module`.

### Task 10: Realtime layer

**Files:** Move (`git mv`) `src/lib/roomState.js(+test)` and `src/lib/roomQuestions.js(+test)` → `src/realtime/`; Create `src/realtime/index.js`, `src/realtime/flushScheduler.js`, `src/realtime/handlers/{joinRoom,codeChange,languageChange,questionChange,codeExecution,disconnect}.js`; Test `src/realtime/handlers.test.js`, `src/realtime/flushScheduler.test.js`; Modify `src/server.js`

**Interfaces — Produces:**
- `attachRealtime({ httpServer, clientUrl, interviewStore, findCodeSnapshot, flushIntervalMs = 10_000 })` → `{ io, shutdown() → Promise<void> }`. `interviewStore` is `prisma.interview` (roomState's existing `update`/`P2025` contract, unchanged); `findCodeSnapshot` is `interviewRepository.findCodeSnapshot`. Owns the `roomState` and `roomQuestions` maps. CORS `{ origin: clientUrl, methods: ["GET","POST"], credentials: true }`.
- Each handler: `export const createXHandler(ctx) => (socket) => (payload) => …` where `ctx = { io, roomState, roomQuestions, interviewStore, findCodeSnapshot }`. Logic copied from `server.js:61-135`; `codeExecution` gains the `if (!socket.rooms.has(roomId)) return;` guard.
- `createFlushScheduler({ flush: () => Promise<void>, intervalMs })` → `{ start(), stop(), flushNow() → Promise<void> }` with the `isFlushing` skip guard.
- `shutdown()`: stop scheduler, `flushAllDirty` once, `io.close()`.
- `server.js`: replaces the inline Socket.io block with `attachRealtime`; on `SIGINT`/`SIGTERM`: `await realtime.shutdown()`, close http server, `prisma.$disconnect()`, exit 0.

- [ ] **Step 1: failing tests** (fake socket `{ id, data: {}, rooms: new Set(), join: vi.fn(r => rooms.add(r)), emit: vi.fn(), to: vi.fn(() => ({ emit })) }`, fake io): join with live entry → emits `question-update` (if set) **then** `code-update`, `language-update`, and does not call `findCodeSnapshot`; join without live entry → emits DB snapshot values; unknown room (`findCodeSnapshot` → null) emits nothing; `code-execution` from a socket not in the room → no broadcast; `question-change` with invalid payload → no emit; disconnect of last member clears the current question and calls flush-on-exit. Scheduler: a tick while a flush is pending is skipped; `stop()` clears the interval.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm test` green.
- [ ] **Step 5:** Manual: boot, open two browser tabs on the same interview room, type in one → appears in the other; wait >10 s, refresh → code persisted. Ctrl+C the server → logs a final flush, exits cleanly.
- [ ] **Step 6:** Commit `refactor(backend): realtime layer with graceful shutdown`.

### Task 11: Agents move and cleanup

**Files:** `git mv src/lib/agents src/agents`; Modify imports in `src/agents/questionGenerator/graph.js` (`../../db.js` → `../../lib/db.js`), `container.js`, `server.js`, tests

- [ ] **Step 1:** `git mv src/lib/agents src/agents`; fix relative imports.
- [ ] **Step 2:** `grep -rn "vi.mock(" src` and confirm each path resolves to an existing file relative to its test (a stale path silently stops mocking). Expected: no path containing `lib/agents`.
- [ ] **Step 3:** `npm test` → green, test count ≥ 108 + new tests.
- [ ] **Step 4:** Remove leftovers: empty dirs, unused `DB_URL`/`INGEST_API_KEY`/Clerk references only if nothing reads them (`grep`). Update `CLAUDE.md` Architecture section (structure, `container.js`, auth strategy, no more `controller.js`/`protectRoute.js`).
- [ ] **Step 5:** Commit `refactor(backend): move agents, update docs`.

### Task 12: Final verification

- [ ] **Step 1:** `npm test` → all green; record count.
- [ ] **Step 2:** Boot (`npm run dev`); boot log contains no env values.
- [ ] **Step 3:** Re-run every baseline request from Task 0 with the same ids into `<scratchpad>/after/`; `diff -r baseline after` → no differences (except `updatedAt`/stats if data changed meanwhile — explain any diff).
- [ ] **Step 4:** Error-body check: `curl /api/interviews/does-not-exist` → 404 `{ "message": "Interview not found" }`; no response anywhere contains an `error` field.
- [ ] **Step 5:** Frontend smoke: `cd frontend && npm run dev`, open Dashboard, Interviews, Profile, an interview room (code sync), and generate questions once if an OpenAI key is configured (do not read it — just try the button).
- [ ] **Step 6:** Commit any fixes; then use superpowers:finishing-a-development-branch.
