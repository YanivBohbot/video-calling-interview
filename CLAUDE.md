# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TalentIQ — a full-stack technical interview platform: video calls (Stream.io), a collaborative Monaco code editor synced over Socket.io, and a tldraw whiteboard. Auth is via Clerk. It's a two-package monorepo (`backend/`, `frontend/`) with no shared build tooling between them.

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
```
There is no lint or test script in `backend/package.json` yet. The AI-question-generator plan (see below) proposes adding Vitest, but that has not been implemented — don't assume `backend/src/lib/ai.js` or a test runner exists without checking first.

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

### Backend is Prisma/Postgres; the API still speaks Mongo-shaped JSON

The backend used to run on MongoDB/Mongoose (the old `backend/src/models/*.js` files) and has been migrated to Prisma + PostgreSQL. To avoid a breaking change to the frontend's existing contract, `backend/src/controllers/controller.js` translates every Prisma record before it leaves the API: `toDoc` / `toUserDoc` / `toInterviewDoc` rename Prisma's `id` → `_id` and `clerkId` → `clerkID`, and reshape `interview.interviewer` into a nested `interviewerId: { _id, name, email, clerkID }` object. When adding new fields or endpoints, follow this same shim pattern rather than exposing raw Prisma field names — the frontend expects the Mongo-style shape.

Everything (routes, controllers) is centralized: there is one `controller.js` with all handlers, and one `db.js` exporting a single `prisma` client singleton. There's no service/repository layer.

### Auth: two headers, and route protection is not wired up

- Primary: `x-clerk-id` header carrying the user's Clerk ID.
- Fallback: `Authorization: Bearer user:<clerkId>` (used for demo/local dev without Clerk).
- The special clerkId value `"demo"` is auto-upserted into a "Demo User" row on first use (see `resolveInterviewerId` in `controller.js`) — this backs the "Guest Mode" button on the sign-in page.
- `backend/src/middlewares/protectRoute.js` implements this resolution as Express middleware, but **it is not currently attached to any router** (`interview.routes.js`, `user.routes.js`, `session.routes.js` call controllers directly). Auth-like header parsing happens ad hoc inside individual controller functions (e.g. `resolveInterviewerId`) instead. Keep this in mind before assuming a route is protected.

### Real-time collaboration is a second, parallel channel

`server.js` creates a Socket.io server alongside the Express app (not under `/api`). Rooms are joined by interview ID; `CollaborativeEditor.tsx` connects directly to `http://localhost:3000` (hardcoded, not env-driven) and emits/listens on `join-room`, `code-change`/`code-update`, `language-change`/`language-update`, `code-execution`/`execution-result`. This is presence/broadcast only — no state is persisted server-side; a client refresh loses in-progress edits until another peer re-broadcasts.

Code execution (the "Run" button) calls the public Piston API (`emkc.org`) directly from the frontend — it is not proxied through the backend.

### Frontend routing has a manual demo-mode bypass

`App.tsx` holds an `isDemo` boolean in local state (not persisted) that, when set via the "Continue as Guest" button, routes around Clerk's `<SignedIn>/<SignedOut>` gates entirely. Any change to the auth flow needs to account for both the real Clerk path and this bypass path.

### In-progress work

`docs/superpowers/plans/2026-05-17-ai-question-generator.md` and the paired `specs/` doc describe a planned feature (OpenAI-backed interview question generation, added to `Interview.questions` as a `Json` column). As of now it is docs-only — no `backend/src/lib/ai.js`, no `openai` dependency, no `Interview.questions` field in `schema.prisma`. Check current file/schema state before building on top of it.
