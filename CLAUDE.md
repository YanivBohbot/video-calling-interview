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
npm test          # vitest run (pure logic in src/lib: SSE parser, AI client, chat reducer)
```

**Database** — Postgres 16 runs in Docker (`docker-compose.yml` at repo root), mapped to host port **6300** (not the default 5432), user/db `talentiq`/`talentiq_secret`.
```bash
docker compose up -d          # postgres + piston
npm run piston:install        # from backend/, once: installs node, typescript, python, java, gcc into Piston
```
The `piston` service (port 2000, `PISTON_URL`) runs code for the editor's Run button; the public Piston API is whitelist-only since 2026-02-15. Piston needs cgroup v2: on Docker Desktop for Windows that means `%USERPROFILE%\.wslconfig` with `[wsl2]` / `kernelCommandLine = cgroup_no_v1=all`, then `wsl --shutdown` (otherwise it crash-loops with "Cgroup v2 not found").

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
  tests/           http/ (cross-layer HTTP tests: buildTestApp() = real container over a stub prisma + fakes)
                   agents/questionGenerator/ (agent tests, same tree as the agent) · architecture/ (import-rule guards) · helpers/testApp.js
  realtime/        Socket.io: attachRealtime, one handler per event, roomState, roomQuestions, flushScheduler
  agents/          questionGenerator (LangGraph workflow), practiceInterviewer + practiceCoach (createAgent), shared tools/ and middleware/
  integrations/    plain HTTP clients for external services: piston/client.js (runs code), leetcode/client.js (GraphQL search)
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
| `candidate` | `x-invite-token: <secret>` from the invite link `/room/<id>#invite=<secret>` (only its SHA-256 is stored in `Interview.inviteTokenHash`) | only `GET /api/interviews/:id/room` (reduced view, never questions/notes), `/api/sessions`, `/api/stream/token`, that interview's AI interviewer (`/api/interviews/:id/ai/*`) and its socket room; can't `question-change` |

- Not the owner → **404** (ids can't be probed); wrong principal kind → 403 `Forbidden`; no credential → 401.
- A Clerk user with no `User` row is created on first request from Clerk's profile. `/api/users` list/creation and `/by-clerk/*` no longer exist.
- Invite links are created/regenerated by the owner (`POST /api/interviews/:id/invite`); regenerating, deleting the interview, or completing/cancelling it kills the link.
- The Stream video `user_id` is derived from the principal, never from the request.
- Frontend: `src/lib/credentials.tsx` (Clerk via `@clerk/react` Core 3 — `<Show when="signed-in">`, not `SignedIn` / demo mode, demo token in `sessionStorage`) and `src/lib/api.ts` (`useApi()` → `apiFetch`, `socketAuth`; `useApi({ invite })` on the candidate page). Base URL from `VITE_API_URL` (`src/lib/config.ts`).
- Backend env (names only): `CLERK_SECRET_KEY` (required), `DEMO_TOKEN_SECRET` (required, ≥ 32 chars), `CLERK_PUBLISHABLE_KEY` (optional, unused server-side).
- Tests act as a principal through `buildTestApp({ principal })` / `authAs(principal)` (`backend/src/tests/helpers/testApp.js`); the real resolver is covered by `auth/identity.test.js` and `tests/http/auth.test.js`.

### Real-time collaboration is a second, parallel channel

`realtime/index.js` attaches Socket.io to the same HTTP server (not under `/api`). Rooms are joined by interview ID; `CollaborativeEditor.tsx` connects to `API_URL` with `auth: socketAuth` (credential checked once, at connection) and uses `join-room`, `code-change`/`code-update`, `language-change`/`language-update`, `question-change`/`question-update`, `code-execution`/`execution-result`. Events from a socket that hasn't joined the room are ignored; `join-room` is refused (`error-message: Forbidden`) for rooms the principal doesn't own (candidates: only their interview). Code is autosaved to `Interview.codeSnapshot` every 10 s, when the last participant leaves, and on SIGINT/SIGTERM; a rejoining client gets the current question, then live code (or the saved snapshot).

Code execution (the "Run" button) goes through `POST /api/code/run` (any principal, 30 runs/min per caller), which calls the self-hosted Piston via `integrations/piston/client.js`; a Piston outage answers 502 "Code runner unavailable".

### Frontend routing has a manual demo-mode bypass

`App.tsx` reads `useCredentials().mode`: "Continue as Guest" fetches a demo token (kept in `sessionStorage`, survives refresh) and routes around Clerk's `<SignedIn>/<SignedOut>` gates. `/room/:id` (candidate) is public. Any change to the auth flow needs to account for the Clerk path, the demo path and the candidate path.

### AI question generator

`backend/src/agents/` drafts interview questions with a LangGraph pipeline (planner → researcher → drafter → validator → human approval → finalize), grounded on real LeetCode problems found with `integrations/leetcode/client.js` (LeetCode's GraphQL API, injected by `container.js`); approved questions land in `Interview.questions` (Json).

```
agents/questionGenerator/       one folder per responsibility (see its README.md)
  index.js          the only entry point — the rest of the backend imports from here (enforced by tests/architecture/aiWiring.test.js)
  graph/            workflow.js (StateGraph, exported uncompiled) · state.js (state + runtime-context schemas) · nodes/<one per file>
  llm/              models.js — initChatModel("provider:model").withStructuredOutput(zod) · prompts.js
  tools/leetcode/   sources.js — attaches verified LeetCode sources to drafted questions
  execution/        generator.js — createQuestionGenerator({ graph, context }) → { start, resume } · checkpointer.js (PostgresSaver)
  errors.js
```

### AI interviewer (in the interview room)

A panel of the interview room (no separate link: the invite link opens it; it opens by itself when the interview already has a session). One AI session per interview. The question on screen lives in `container.realtime.roomQuestions` (a Map shared by the realtime channel, which writes it, and `practice.service.js`, which reads it). When the interviewer switches question mid-session, that turn gets a system note right before the candidate's message (`buildQuestionSwitchNote`) so the AI announces the new question; a note in the system prompt alone was ignored about half the time. Only the invited candidate starts it and writes to the AI; the owner follows the conversation (polling), may end the session, and alone gets the report (the candidate's `GET` always answers `reportStatus: "none"`, `report: null`). Frontend: `components/ai/AiInterviewerPanel.tsx` (in the right column, under the video: always shown to the candidate; for the interviewer, a tab next to the Questions list (`components/QuestionList.tsx`), whose Ask goes through the editor's socket via `EditorHandle.ask`; reads the shared editor through `CollaborativeEditor`'s `onCodeChange`), state in `lib/useAiInterviewer.ts`, HTTP + SSE in `lib/aiInterviewer.ts`. Two independent `createAgent` agents:

```
agents/practiceInterviewer/   ReAct agent: asks the interview's question (the one on screen via Ask, else the first technical one; find_problem on LeetCode only when there is none), read_candidate_code, run_code, end_session; streamTurn() → token/tool/done events, history()
agents/practiceCoach/         ReAct agent with responseFormat = toolStrategy(PracticeReportSchema); the report keeps only tests run_code really ran
agents/tools/                 shared LangChain tools, one factory per file (clients injected as functions)
agents/middleware/            turnLimits (≤6 model / ≤8 tool calls per turn), createCallBudget (coach: wrap hooks — built-in limit middlewares break the structured-output retry in langchain 1.5), withFallback, content-free logging
```

`/api/interviews/:id/ai` (behind the normal `authenticate`; access checked in `practice.service.js`): `POST /sessions` (candidate), `GET /sessions/current` (`{ sessionId }`, so a refreshed room finds its session), `GET /sessions/:sid`, `POST /sessions/:sid/messages` (SSE: `token`, `tool`, `done`, `error`; refusals are JSON before the stream; a client disconnect aborts the turn), `POST /sessions/:sid/finish` (report written in the background), `POST /sessions/:sid/report` (owner only: writes a failed report again). The candidate polls too while a session is active, so the owner's End reaches them. Caps (`services/practice.service.js`): 1 session per interview (started under a per-interview advisory lock, `startExclusive`), 60 min and 60 messages per session (atomic counter), one reply at a time per session (409), 10 messages/min per interview. A turn aborted mid-tool leaves unanswered tool calls; `streamTurn` answers them ("Cancelled…") before the next turn, or OpenAI would reject the thread. The coach may not report before it ran the candidate's code (`requireToolBeforeResponse`), and `passed` is recomputed from the real output. Sessions are in table `ai_practice_sessions` (not `practice_sessions`: that one belongs to an unrelated older branch); the conversation is in the shared PostgresSaver, thread `practice:<sessionId>`. Agent tests use LangChain's `fakeModel()` — no key.

The agents' tests are not next to their code: they live in `src/tests/agents/questionGenerator/`, in the same folder tree (`graph/workflow.js` → `tests/agents/questionGenerator/graph/workflow.test.js`).

`container.js` compiles `workflow` with the checkpointer and builds its runtime context, lazily (`container.ai.setup` is called by `server.js`); agents never import Prisma, `src/integrations/` or read `process.env`. Models are full LangChain `provider:model` strings: `AI_MODEL` (default `openai:gpt-4o-mini`) and `AI_MODEL_FALLBACK` (default `openai:gpt-4o`); a bare name means OpenAI. Audit and rationale: `docs/superpowers/audits/2026-11-20-langchain-agent-audit.md`.
