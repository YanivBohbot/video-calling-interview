# Backend layered architecture — design

Date: 2026-11-19 · Branch: `feat/question-generator-langgraph` · Status: approved shape, details open to later changes

## Intent

The backend is hard to read and hard to test: one 469-line `controllers/controller.js` mixes HTTP, Prisma, validation and the Mongo-shape shim; `aiController.js` imports helpers from it; `server.js` holds Socket.io handlers, in-memory room state, the flush timer, routing and boot. The user wants a backend split into clear layers (routes → controller → service → repository) with dependency injection, meaningful names, and every layer testable on its own — a better base for upcoming work (notably replacing Clerk with OAuth later).

## Goals

- Layered, feature-organised structure with a single composition root (`container.js`) doing manual DI.
- Controllers never touch Prisma; services never touch `req`/`res`; repositories are the only Prisma callers.
- Services unit-testable by passing fake repositories — no `vi.mock` of file paths for new tests.
- Authentication isolated behind one replaceable "identity strategy" so a future OAuth provider is a drop-in swap.
- Safe fixes bundled in (see "Behaviour changes").

## Non-goals

- **No route protection / ownership checks** (option A chosen). Routes stay as open as today; only the two AI routes keep `protectRoute`-equivalent auth. Real auth is a later, separate project (Clerk → OAuth).
- No frontend changes. No NestJS, no TypeScript migration, no microservices.
- No change to the LangGraph pipeline's behaviour.

## Anti-goals (failure even if it "works")

- Any change to URLs, HTTP status codes, or JSON response shapes (`_id`, `clerkID`, nested `interviewerId` object) for success responses.
- Losing test coverage: every behaviour covered by today's 108 tests stays covered.
- Reading, printing, or committing secret values. Code may reference env var *names*; nobody reads `.env`, and logs never contain secret values.

## Constraints

- Express 5, ESM JavaScript, Vitest, Prisma 6 / Postgres. Port and CORS behaviour unchanged.
- Socket.io event names and semantics unchanged (`join-room`, `code-change`/`code-update`, `language-change`/`language-update`, `question-change`/`question-update`, `code-execution`/`execution-result`), including the autosave (10 s flush, flush-on-exit) and the "replay current question before snapshot" ordering.
- `npm run seed` and Prisma scripts keep working.

## Approaches considered

1. **Express, layered + manual DI (chosen).** Keeps JS/ESM and the test suite; the LangGraph code already takes its dependencies as parameters (`buildGraph({ checkpointer, … })`), so the style is consistent. Medium change, low risk.
2. **Migrate to NestJS.** Built-in modules/DI/guards/pipes, but requires TypeScript, rewriting every file (Socket.io → gateways) and the test setup. Rejected by the user for now.
3. **Auth scope** — A (structure only, auth pluggable) chosen over B (protect routes with the spoofable `x-clerk-id` header — false security) and C (real Clerk JWT verification — too large, and Clerk is due to be replaced by OAuth).

## Target structure

```
backend/src/
  server.js            boot only: load config → build container → create app + http server → attach realtime → listen → warm-ups
  app.js               createApp(container): json, cors, routes, /health, 404, error handler (no listen — testable with Supertest)
  container.js         composition root: prisma, repositories, services, controllers, auth strategy, external clients
  config/env.js        zod-validated config object; never logged
  shared/
    errors.js          AppError + NotFoundError, ValidationError, ConflictError, UnauthorizedError, RateLimitError, UpstreamError
    errorHandler.js    maps AppError → status/message; unknown errors → 500 generic message, details logged server-side
    asyncHandler.js    (only if needed for Express 5 — it forwards rejected promises natively)
    validate.js        zod middleware/helper for body/params/query
    mongoShape.js      toDoc, toUserDoc, toInterviewDoc (moved verbatim)
  auth/
    identityStrategy.js     contract: resolveIdentity(req) → { id, name, email, clerkID } | null
    clerkHeaderStrategy.js  today's logic (x-clerk-id, then "Bearer user:<id>")
    requireIdentity.js      middleware factory: requireIdentity(strategy) → sets req.user or 401
  modules/
    interviews/  interview.routes.js · interview.controller.js · interview.service.js · interview.repository.js · interview.schemas.js
    users/       user.routes.js · user.controller.js · user.service.js · user.repository.js · user.schemas.js
    sessions/    session.routes.js · session.controller.js · session.service.js · session.repository.js
    stream/      stream.routes.js · stream.controller.js · stream.service.js (StreamClient injected)
    questions/   question.routes.js · question.controller.js · question.service.js · question.validation.js
  realtime/
    index.js            attachRealtime({ httpServer, config, roomStore, interviewRepository }) → io
    handlers/*.js       one handler per event (joinRoom, codeChange, languageChange, questionChange, codeExecution, disconnect)
    roomState.js        moved from lib/ (unchanged API)
    roomQuestions.js    moved from lib/ (unchanged API)
    flushScheduler.js   the 10 s interval with the isFlushing guard; start()/stop() for tests and shutdown
  agents/              lib/agents/** moved as-is (leetcodeMcpClient, questionGenerator/*)
  lib/
    db.js              prisma singleton + connectDB (kept; container imports it)
    rateLimiter.js     kept
    seed.js            kept (path referenced by package.json)
```

Old files (`controllers/`, `routes/`, `middlewares/`, `lib/env.js`, `lib/roomState.js`, `lib/roomQuestions.js`, `lib/agents/`) are removed once their content has moved — no re-export shims left behind.

### Layer rules

- **Routes**: wire URL + validation middleware + controller method. Route order preserved (e.g. `/stats`, `/activity` before `/:id`; `/:id/questions/*` before `/:id`; `/by-clerk/:clerkId` routes).
- **Controller**: built by `createXController({ xService })`. Reads params/body/headers, calls the service, applies `mongoShape`, sends status + JSON. Throws/forwards errors; no try/catch-per-handler boilerplate.
- **Service**: built by `createXService({ xRepository, … })`. Business rules (defaults like duration 60, `interviewType` "technical", status whitelist, demo-user upsert, stats/avg-duration math). Throws `AppError` subclasses. Knows nothing about Express.
- **Repository**: built by `createXRepository({ prisma })`. Only Prisma calls, owns the `select` shapes (`INTERVIEWER_SELECT`, `INTERVIEW_LIST_SELECT`, `USER_SELECT`). Translates Prisma `P2025` → `NotFoundError`, `P2002` → `ConflictError`.
- Factories are plain functions returning objects (matches the existing `createRateLimiter` style), not classes.

### Cross-module dependencies

- `questions` service depends on `interviewRepository` (load interview, reload after approval) and on the agents' `startQuestionGeneration` / `resumeQuestionGeneration`, injected through the container. Question-payload validation (`validateQuestionsPayload`, LeetCode source checks) moves to `questions/question.validation.js`; `interviews` imports it from there for `PATCH /:id`.
- The question routes keep their URLs (`POST /api/interviews/:id/questions/generate|approve`): `question.routes.js` is a `Router({ mergeParams: true })` mounted by `app.js` at `/api/interviews/:id/questions` **before** the interviews router, protected by `requireIdentity(clerkHeaderStrategy)`. The strategy looks users up through `userRepository`, not Prisma directly.
- `agents/` keeps reading its own model/DB env vars (`AI_MODEL`, `AI_MODEL_FALLBACK`, `DATABASE_URL`) as today; only the question service's `count` and the `OPENAI_API_KEY` check move to the config object. Rewiring agents onto `config` is out of scope.
- Resolving an interviewer from a raw clerk id (incl. `"demo"` upsert) lives in `user.service.js` (`resolveInterviewerId`) and is injected into `interview.service.js`.

## Behaviour changes (deliberate, small)

1. **No secret logging**: remove `console.log("Starting server with ENV:", ENV)` and stray `console.log(process.env.PORT)` lines. Boot logs only non-secret facts (port, client URL).
2. **Error responses**: unexpected errors (non-`AppError`) return 500 with the handler's current generic `message` and **no** `error: err.message` field; the detail is logged server-side. `AppError`s are exposed as-is: 4xx keep their current messages; `AIConfigError` / "AI not configured: OPENAI_API_KEY missing" stay 500 with their message; AI provider failures stay 502 `{ message: "AI service unavailable" }` (the `error` detail field is dropped); `RateLimitError` keeps `retryAfter` in the body (the frontend reads `body.retryAfter`; it never reads `body.error`). A few handlers currently answer 400 for unexpected errors (`createInterview`, `updateUser`); those become 500 when the error is unexpected, and stay 400 for validation failures. Existing tests only assert status codes and success bodies, so they stay valid.
3. **Env validation**: `config/env.js` exports `loadConfig(env)` — a factory, called only from `server.js` (never parsed on import, so tests don't need env). Required: `DATABASE_URL` (the name `prisma/schema.prisma` uses), `CLIENT_URL`. Defaults: `PORT` 3000, `AI_QUESTION_COUNT` 6. Optional (feature checked at use, as today): `OPENAI_API_KEY`, `STREAM_API_KEY`, `STREAM_API_SECRET`, Clerk/Inngest keys. On failure it prints only the `issue.path` names, never zod messages (they can echo values). No new required variables beyond what boot needs today. Unused `DB_URL` dropped if nothing reads it.
4. **Remove dead `/books` route.**
5. **`code-execution`** ignored unless the socket is in that room (same guard as the other events).
6. **Graceful shutdown** (SIGINT/SIGTERM): stop the flush scheduler, flush dirty rooms once, close io/http, disconnect Prisma. Small addition; protects the autosave.

## Testing

- Existing 108 tests move with their code; assertions unchanged except where a test imported a removed path (rewritten against the new factory with injected fakes, same cases).
- New unit tests: each service with fake repositories (happy path + error mapping); `errorHandler`; `clerkHeaderStrategy` / `requireIdentity`; `config/env` validation.
- **Live baseline before any code change**: curl every GET endpoint on the current server (`/api/interviews`, `/api/interviews/stats`, `/api/interviews/activity`, `/api/interviews/:id`, `/api/users`, `/api/users/by-clerk/:id`, `/api/users/by-clerk/:id/stats`, `/api/sessions`, `/api/sessions/:id`) against the seeded DB and save the JSON in the session scratchpad; re-run at the end and diff (timestamps from `updatedAt` aside). `/api/stream/token` is excluded — its response is a credential.
- Contract tests are built from the **real** controller + service + repository over a stubbed `prisma` object, asserting both the Prisma call arguments (`select`/`include`/`where`/`orderBy`) and the JSON — so drift in repository select shapes is caught, not only in `mongoShape`. Quirks pinned explicitly: `PATCH /:id/status` returns `interviewerId` as a plain string (no include) while `PATCH /:id` returns it nested; list excludes `codeSnapshot` and `questions`; `getUserStats` returns zeros with 200 for an unknown user; the `x-clerk-id` header wins over `?interviewerId`.
- New HTTP contract tests with **Supertest** (new devDependency) against `createApp(fakeContainer)`: one per route asserting status + exact JSON shape (`_id`, `clerkID`, nested `interviewerId`), so the "no contract change" anti-goal is checked mechanically.
- Realtime handlers tested with a fake socket/io object (no real server).
- Done = `npm test` green, server boots against local Postgres, and a manual smoke via curl of `/health`, `GET /api/interviews`, `GET /api/sessions`.

## Builder's latitude (my calls, changeable)

- Exact file names within the structure above; whether `asyncHandler` is needed (Express 5 forwards async errors natively — prefer not adding it).
- Zod schemas reproduce current validation exactly (required fields, status whitelist); no stricter rules in this project.
- Logging stays `console.*` (no logger library) — structured logging is a later improvement.
- Migration order: shared/config/auth first, then one module at a time (sessions → users → interviews → questions → stream), then realtime, then delete old files — keeping tests green after each step. The `lib/agents` → `agents/` move is a separate, last step done with `git mv`; afterwards every `vi.mock(` path is grepped and checked to resolve (a stale mock path silently stops mocking).

## Open for later (explicitly out of scope)

- Route protection and ownership checks; replacing Clerk with OAuth (plug a new strategy into `auth/`).
- Frontend API client with env-driven base URL (currently hardcoded `http://localhost:3001`).
- Rate limiting beyond the AI routes, security headers (helmet), structured logging.
