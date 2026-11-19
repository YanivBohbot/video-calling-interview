# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TalentIQ — a full-stack technical interview platform: video calls (Stream.io), a collaborative Monaco code editor synced over Socket.io, and a tldraw whiteboard. Auth is via Clerk. It's a two-package monorepo (`backend/`, `frontend/`) with no shared build tooling between them.

## MCP Market skills

For any backend task (architecture, auth, security, tests, performance, DevOps), first consult the `mcp__mcpmarket__skill_backend_development` tool and read the relevant `references/*` files it lists (e.g. `backend-architecture.md`, `backend-authentication.md`, `backend-security.md`, `backend-testing.md`). Its guidance is advisory: the project's own constraints in this file take precedence.

## Commands

All commands below are run from `backend/` or `frontend/` — there is no root-level dev/test script.

**Backend** (Express 5, ESM, port 3000 by default)
```bash
cd backend
npm run dev              # nodemon src/server.js
npm run db:migrate       # prisma migrate dev
npm run db:generate      # prisma generate
npm run seed             # wipes and reseeds users/sessions/interviews (src/lib/seed.js)
npx prisma studio        # visual DB browser
npm test                 # vitest run (unit + Supertest HTTP contract tests, no DB needed)
```
There is no lint script in `backend/package.json`.

**Frontend** (React 19 + Vite + TS, port 5173 by default)
```bash
cd frontend
npm run dev
npm run build     # tsc -b && vite build
npm run lint      # eslint .
```

**Database** — Postgres 16 runs in Docker (`docker-compose.yml` at repo root), mapped to host port **5436** (not the default 5432), user/db `talentiq`/`talentiq_secret`.
```bash
docker compose up -d
```

## Architecture

### Backend layout: layers wired by one composition root

```
backend/src/
  server.js        boot only: loadConfig → createContainer → createApp → attachRealtime → listen (+ graceful shutdown)
  app.js           createApp(container): helmet, cors, /api rate limit (1000/15 min/IP), json, routers, /health, JSON 404, error handler
  container.js     composition root — picks implementations and wires repositories → services → controllers → routes
  config/env.js    loadConfig(env): zod-validated, never logged; failures name variables, never values
  shared/          errors.js (AppError + subclasses), handle.js, errorHandler.js, validate.js (zod middleware), mongoShape.js, prismaErrors.js, stats.js
  auth/            principal kinds, identityResolver (Clerk / demo / invite → principal), authenticate + requireKind middleware, demoTokens, inviteSecrets, clerkVerifier
  routes/          <x>.routes.js       — URL → controller (createXRouter)
  controllers/     <x>.controller.js   — HTTP in/out, Mongo-shaping (createXController)
  services/        <x>.service.js      — business rules, throw AppErrors (createXService)
  repositories/    <x>.repository.js   — the only Prisma callers, own select/include (createXRepository)
  validators/      <x>.schemas.js (zod request schemas, client-facing messages) + question.validation.js
                   features: interview, user, session, question (AI), stream
  tests/           cross-layer HTTP tests: buildTestApp() = real container over a stub prisma + fakes
  realtime/        Socket.io: attachRealtime, one handler per event, roomState, roomQuestions, flushScheduler
  agents/          LangGraph question-generator pipeline + LeetCode MCP client
  lib/             db.js (prisma singleton), rateLimiter.js, seed.js
```

Layer rules: routes wire URLs and request validation (`validate({ body | params | query })` with a schema from `validators/`); controllers read the request, call one service and shape the response (no Prisma); services hold the business rules and throw `AppError`s (no `req`/`res`); repositories are the only Prisma callers and own the `select`/`include` shapes. Every layer is a plain factory taking its dependencies as parameters (`createInterviewService({ interviewRepository, clientUrl })`), so tests inject fakes instead of using `vi.mock`. `createContainer({ config, prisma, generation?, clerkVerifier?, identityResolver?, getStreamClient?, now? })` accepts fakes for every external dependency. Controllers wrap each handler in `handle("<fallback message>", fn)`: unexpected errors become a 500 with that generic message and the detail is only logged — never put `err.message` in a response.

### The API still speaks Mongo-shaped JSON

The backend used to run on MongoDB/Mongoose and was migrated to Prisma + PostgreSQL. To avoid a breaking change to the frontend's contract, controllers pass every record through `shared/mongoShape.js`: `toDoc` / `toUserDoc` / `toInterviewDoc` rename `id` → `_id` and `clerkId` → `clerkID`, and reshape `interview.interviewer` into a nested `interviewerId: { _id, name, email, clerkID }` object. When adding fields or endpoints, follow this shim rather than exposing raw Prisma field names. Known quirk kept on purpose: `PATCH /api/interviews/:id/status` returns `interviewerId` as a plain id (no include).

### Auth: verified principals, ownership on every route

Every `/api` route (except `GET /health` and `POST /api/auth/demo`) and every Socket.io connection resolves the caller to a **principal** (`backend/src/auth/`):

| Principal | Credential | May do |
|---|---|---|
| `interviewer` | `Authorization: Bearer <Clerk session token>` (verified with `@clerk/express`, 60 s tokens — the frontend calls `getToken()` per request) | only **their own** interviews, profile (`/api/users/me`), AI generation (10/h) |
| `demo` | `Authorization: Bearer <demo token>` from `POST /api/auth/demo` (HS256, 8 h, `DEMO_TOKEN_SECRET`) | same as an interviewer on the shared "demo" account; **cannot delete**; AI 5/h shared by all demo visitors |
| `candidate` | `x-invite-token: <secret>` from the invite link `/room/<id>#invite=<secret>` (only its SHA-256 is stored in `Interview.inviteTokenHash`) | only `GET /api/interviews/:id/room` (reduced view, never questions/notes), `/api/sessions`, `/api/stream/token`, and that interview's socket room; can't `question-change` |

- Not the owner → **404** (ids can't be probed); wrong principal kind → 403 `Forbidden`; no credential → 401.
- A Clerk user with no `User` row is created on first request from Clerk's profile. `/api/users` list/creation and `/by-clerk/*` no longer exist.
- Invite links are created/regenerated by the owner (`POST /api/interviews/:id/invite`); regenerating, deleting the interview, or completing/cancelling it kills the link.
- The Stream video `user_id` is derived from the principal, never from the request.
- Frontend: `src/lib/credentials.tsx` (Clerk / demo mode, demo token in `sessionStorage`) and `src/lib/api.ts` (`useApi()` → `apiFetch`, `socketAuth`; `useApi({ invite })` on the candidate page). Base URL from `VITE_API_URL` (`src/lib/config.ts`).
- Backend env (names only): `CLERK_SECRET_KEY` (required), `DEMO_TOKEN_SECRET` (required, ≥ 32 chars), `CLERK_PUBLISHABLE_KEY` (optional, unused server-side).
- Tests act as a principal through `buildTestApp({ principal })` / `authAs(principal)` (`backend/src/tests/testApp.js`); the real resolver is covered by `auth/identity.test.js` and `tests/auth.test.js`.

### Real-time collaboration is a second, parallel channel

`realtime/index.js` attaches Socket.io to the same HTTP server (not under `/api`). Rooms are joined by interview ID; `CollaborativeEditor.tsx` connects to `API_URL` with `auth: socketAuth` (credential checked once, at connection) and uses `join-room`, `code-change`/`code-update`, `language-change`/`language-update`, `question-change`/`question-update`, `code-execution`/`execution-result`. Events from a socket that hasn't joined the room are ignored; `join-room` is refused (`error-message: Forbidden`) for rooms the principal doesn't own (candidates: only their interview). Code is autosaved to `Interview.codeSnapshot` every 10 s, when the last participant leaves, and on SIGINT/SIGTERM; a rejoining client gets the current question, then live code (or the saved snapshot).

Code execution (the "Run" button) calls the public Piston API (`emkc.org`) directly from the frontend — it is not proxied through the backend.

### Frontend routing has a manual demo-mode bypass

`App.tsx` reads `useCredentials().mode`: "Continue as Guest" fetches a demo token (kept in `sessionStorage`, survives refresh) and routes around Clerk's `<SignedIn>/<SignedOut>` gates. `/room/:id` (candidate) is public. Any change to the auth flow needs to account for the Clerk path, the demo path and the candidate path.

### AI question generator

`backend/src/agents/` drafts interview questions with a LangGraph pipeline (planner → researcher → drafter → validator → human approval → finalize), grounded on LeetCode problems via the LeetCode MCP server; approved questions land in `Interview.questions` (Json).

```
agents/questionGenerator/          layout of docs.langchain.com/oss/javascript/langgraph/application-structure (see its README.md)
  agent.js          `workflow` — the StateGraph (State + QuestionGenContext), exported uncompiled
  utils/state.js    state schema + runtime-context schema (chooseSearch, searchProblems, draft, saveQuestions)
  utils/nodes.js    plain (state, runtime) nodes; dependencies from runtime.context
  utils/tools.js    LeetCode MCP client (pinned LEETCODE_MCP_PACKAGE, close()) + createSearchProblems
  utils/models.js   initChatModel("provider:model").withStructuredOutput(zod) — chooseSearch, draft
  utils/prompts.js · utils/sources.js · errors.js
  checkpointer.js   PostgresSaver in its own "langgraph" schema (setup() at boot)
  runner.js         createQuestionGenerator({ graph, context }) → { start, resume } — passes context on every invoke
```

`container.js` compiles `workflow` with the checkpointer and builds its runtime context, lazily (`container.ai.setup / warmUp / close` are called by `server.js`); agents never import Prisma or read `process.env`. Models are full LangChain `provider:model` strings: `AI_MODEL` (default `openai:gpt-4o-mini`) and `AI_MODEL_FALLBACK` (default `openai:gpt-4o`); a bare name means OpenAI. Audit and rationale: `docs/superpowers/audits/2026-11-20-langchain-agent-audit.md`.
