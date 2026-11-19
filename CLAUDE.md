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
  auth/            identity strategies (clerkHeaderStrategy) + requireIdentity middleware
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

Layer rules: routes wire URLs and request validation (`validate({ body | params | query })` with a schema from `validators/`); controllers read the request, call one service and shape the response (no Prisma); services hold the business rules and throw `AppError`s (no `req`/`res`); repositories are the only Prisma callers and own the `select`/`include` shapes. Every layer is a plain factory taking its dependencies as parameters (`createInterviewService({ interviewRepository, resolveInterviewerId })`), so tests inject fakes instead of using `vi.mock`. `createContainer({ config, prisma, generation?, identityStrategy?, getStreamClient?, now? })` accepts fakes for every external dependency. Controllers wrap each handler in `handle("<fallback message>", fn)`: unexpected errors become a 500 with that generic message and the detail is only logged — never put `err.message` in a response.

### The API still speaks Mongo-shaped JSON

The backend used to run on MongoDB/Mongoose and was migrated to Prisma + PostgreSQL. To avoid a breaking change to the frontend's contract, controllers pass every record through `shared/mongoShape.js`: `toDoc` / `toUserDoc` / `toInterviewDoc` rename `id` → `_id` and `clerkId` → `clerkID`, and reshape `interview.interviewer` into a nested `interviewerId: { _id, name, email, clerkID }` object. When adding fields or endpoints, follow this shim rather than exposing raw Prisma field names. Known quirk kept on purpose: `PATCH /api/interviews/:id/status` returns `interviewerId` as a plain id (no include).

### Auth: one replaceable identity strategy, most routes still open

- `auth/clerkHeaderStrategy.js` resolves the caller from the `x-clerk-id` header, falling back to `Authorization: Bearer user:<clerkId>`. It trusts the header without verification (spoofable) — real auth (OAuth, replacing Clerk) is planned as a separate project: write a new strategy with the same `resolveIdentity(req)` contract and swap it in `container.js`.
- Only `POST /api/interviews/:id/questions/generate|approve` use `requireIdentity`. **All other routes are unprotected** and have no ownership checks.
- The special clerkId `"demo"` is auto-upserted into a "Demo User" row on first use (`userService.resolveInterviewerId`) — this backs "Guest Mode".

### Real-time collaboration is a second, parallel channel

`realtime/index.js` attaches Socket.io to the same HTTP server (not under `/api`). Rooms are joined by interview ID; `CollaborativeEditor.tsx` connects to `http://localhost:3001` (hardcoded) and uses `join-room`, `code-change`/`code-update`, `language-change`/`language-update`, `question-change`/`question-update`, `code-execution`/`execution-result`. Events from a socket that hasn't joined the room are ignored. Code is autosaved to `Interview.codeSnapshot` every 10 s, when the last participant leaves, and on SIGINT/SIGTERM; a rejoining client gets the current question, then live code (or the saved snapshot).

Code execution (the "Run" button) calls the public Piston API (`emkc.org`) directly from the frontend — it is not proxied through the backend.

### Frontend routing has a manual demo-mode bypass

`App.tsx` holds an `isDemo` boolean in local state (not persisted) that, when set via the "Continue as Guest" button, routes around Clerk's `<SignedIn>/<SignedOut>` gates entirely. Any change to the auth flow needs to account for both the real Clerk path and this bypass path.

### In-progress work

`docs/superpowers/plans/2026-05-17-ai-question-generator.md` and the paired `specs/` doc describe a planned feature (OpenAI-backed interview question generation, added to `Interview.questions` as a `Json` column). As of now it is docs-only — no `backend/src/lib/ai.js`, no `openai` dependency, no `Interview.questions` field in `schema.prisma`. Check current file/schema state before building on top of it.
