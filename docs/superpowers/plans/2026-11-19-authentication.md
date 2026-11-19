# Authentication & Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trusted `x-clerk-id` header with verified identities (Clerk interviewer, server-issued demo token, per-interview candidate invite) and enforce ownership on every `/api` route and Socket.io connection.

**Architecture:** `auth/` turns a request or socket handshake into a **principal** (`interviewer` | `demo` | `candidate`). Middleware `authenticate` attaches it, `requireKind` gates routes, and services receive the principal and enforce ownership (not-owner → 404). External verifiers (Clerk) are injected through `createContainer` so tests never hit the network. The frontend gets one `apiFetch` that attaches the right credential.

**Tech Stack:** Express 5, Prisma 6, Socket.io 4, zod 3, `@clerk/express` (new), `jose` (new), React 19 + `@clerk/clerk-react`, Vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-11-19-authentication-design.md`

## Global Constraints

- Branch `feat/auth`. Backend `npm test` green after every task; frontend `npm run build` green from Task 9 on (5 pre-existing lint errors may remain; no new ones).
- Never read, print or commit `.env` or any token/secret value. Tests use obviously fake values (`"test-demo-secret-…"` ≥ 32 chars).
- Status codes: no/invalid credential → 401 `{ message: "Unauthorized" }`; wrong principal kind → 403 `{ message: "Forbidden" }`; not owner → 404 with the resource's usual message (`"Interview not found"`); demo delete → 403 `{ message: "Not allowed in demo mode" }`.
- Candidate responses never contain `questions`, `notes`, or the interviewer's e-mail.
- Invite URL format: `<CLIENT_URL>/room/<interviewId>#invite=<secret>` (fragment, never query string). Secret = 32 random bytes base64url; DB stores SHA-256 hex only.
- Demo token: HS256 JWT, `sub: "demo"`, `aud: "talentiq-demo"`, 8 h expiry, secret `DEMO_TOKEN_SECRET` (≥ 32 chars).
- Limits: `POST /api/auth/demo` 20 / 15 min / IP; AI generation 10/h per interviewer, **5/h total for demo** (key `"demo"`).
- Keep existing success JSON shapes (Mongo-shaped) except the documented removals (`totalUsers`, `/api/users` list/create, `/by-clerk/*` → `/me`).

## Review Focus

1. **Clerk token expires mid-session (60 s)** — a page open for minutes must keep working: frontend calls `getToken()` per request and socket `auth` is a callback. Pinned in Task 10 (manual check: idle 2 min, then act).
2. **Invite for a completed/cancelled interview** — link must stop working (401). Pinned in Task 3 test `refuses an invite once the interview is completed`.
3. **Candidate asking the socket for another room** — `join-room` with a different id must be refused. Pinned in Task 8.
4. **Fresh Clerk user with no `User` row** — first request provisions the row instead of failing. Pinned in Task 3 test `provisions a missing user from Clerk`.
5. **Demo visitor deleting the showcase** — 403. Pinned in Task 5.

---

## File map

| Path | Responsibility |
|---|---|
| `backend/prisma/schema.prisma` + migration | `Interview.inviteTokenHash String? @unique`, `inviteCreatedAt DateTime?` |
| `backend/src/auth/principal.js` | principal kinds + helpers |
| `backend/src/auth/demoTokens.js` | issue/verify demo JWT (jose) |
| `backend/src/auth/inviteSecrets.js` | generate/hash invite secrets |
| `backend/src/auth/clerkVerifier.js` | thin adapter over `@clerk/express` (verify token, fetch user) |
| `backend/src/auth/identityResolver.js` | credential → principal (replaces `clerkHeaderStrategy.js`) |
| `backend/src/auth/middleware.js` | `authenticate`, `requireKind` (replaces `requireIdentity.js`) |
| `backend/src/routes/auth.routes.js`, `controllers/auth.controller.js` | `POST /api/auth/demo` |
| services/controllers/routes/repositories | principal-aware ownership |
| `backend/src/realtime/authenticateSocket.js` | Socket.io handshake middleware |
| `frontend/src/lib/api.ts`, `frontend/src/lib/credentials.tsx` | credential context + `apiFetch` + socket auth |
| `frontend/src/pages/CandidateRoom.tsx` | public candidate room |

---

### Task 1: Config, dependencies, migration

**Files:** Modify `backend/src/config/env.js`, `backend/src/config/env.test.js`, `backend/prisma/schema.prisma`, `backend/package.json`, `backend/src/tests/testApp.js`, `backend/.env.example` (names only, create if absent — check `git stash list`: a stashed `.env.example` edit exists; do not pop it, just add the names to the committed file)

**Interfaces — Produces:** `loadConfig(env)` adds `clerk: { secretKey, publishableKey }`, `demoTokenSecret: string`. `TEST_CONFIG` gains `clerk: { secretKey: "sk_test_fake", publishableKey: "pk_test_fake" }`, `demoTokenSecret: "test-demo-secret-0123456789abcdef0123"`.

- [ ] **Step 1: failing tests** in `env.test.js`: missing `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` or `DEMO_TOKEN_SECRET` → throws naming each; `DEMO_TOKEN_SECRET` of 10 chars → throws naming it; message never contains the provided values. Update `base` with the three names (fake values).
- [ ] **Step 2:** `npx vitest run src/config` → FAIL.
- [ ] **Step 3:** Implement (required, `.min(1)`, demo secret `.min(32)`). `npm i @clerk/express jose`. Add the Prisma fields; `npx prisma migrate dev --name interview_invite_token` (creates the migration; existing rows get NULL).
- [ ] **Step 4:** `npx vitest run` → all green; `npx prisma generate` ok.
- [ ] **Step 5:** Tell the user (in the final message, not now) which three names their `.env` needs. Commit `feat(auth): config, deps and invite-token columns`.

### Task 2: Demo tokens and invite secrets

**Files:** Create `backend/src/auth/demoTokens.js`, `backend/src/auth/inviteSecrets.js`, `backend/src/auth/principal.js`; Test `backend/src/auth/tokens.test.js`

**Interfaces — Produces:**
- `createDemoTokens({ secret, now = () => Date.now() })` → `{ issue() → Promise<{ token: string, expiresAt: string /*ISO*/ }>, verify(token) → Promise<boolean> }` (HS256, `sub: "demo"`, `aud: "talentiq-demo"`, `exp` = now + 8 h; `verify` false on any failure, never throws).
- `generateInviteSecret()` → `{ secret: string, hash: string }`; `hashInviteSecret(secret) → string` (SHA-256 hex).
- `principal.js`: `INTERVIEWER = "interviewer"`, `DEMO = "demo"`, `CANDIDATE = "candidate"`; `isOwnerKind(p) → boolean` (interviewer or demo).

- [ ] **Step 1: failing tests** — issued token verifies; tampered last char → false; token signed with another secret → false; `now` advanced 8 h + 1 s → false; `expiresAt` = issue time + 8 h; secret is 43 chars base64url; `hashInviteSecret(secret) === hash`; two generations differ.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(auth): demo tokens and invite secrets`.

### Task 3: Identity resolver and middleware

**Files:** Create `backend/src/auth/clerkVerifier.js`, `backend/src/auth/identityResolver.js`, `backend/src/auth/middleware.js`; Delete `backend/src/auth/clerkHeaderStrategy.js`, `backend/src/auth/requireIdentity.js`, `backend/src/auth/auth.test.js`; Test `backend/src/auth/identity.test.js`; Modify repositories (`user.repository.js`: `createFromClerk({ clerkId, name, email, profileImage })`; `interview.repository.js`: `findByInviteHash(hash)`, `setInviteHash(id, hash)`)

**Interfaces:**
- `createClerkVerifier({ secretKey, publishableKey, authorizedParties })` → `{ verify(token) → Promise<{ clerkId } | null>, fetchUser(clerkId) → Promise<{ name, email, profileImage }>}` — wraps `verifyToken` and `createClerkClient().users.getUser` from `@clerk/express`; `verify` returns `null` on any failure (handle both a returned `{ data, errors }` and a thrown error). Not unit-tested (network); everything else receives a fake with the same shape.
- `createIdentityResolver({ clerkVerifier, demoTokens, userRepository, interviewRepository })` → `{ fromCredentials({ bearer, invite }) → Promise<Principal | null>, fromRequest(req) → Promise<Principal | null> }`
  - `Principal` = `{ kind: "interviewer", userId, clerkId }` | `{ kind: "demo", userId, clerkId: "demo" }` | `{ kind: "candidate", interviewId }`.
  - Order: bearer → `demoTokens.verify` (cheap, local) → else `clerkVerifier.verify`; else invite → `findByInviteHash(hashInviteSecret(invite))`, refused if status `completed`/`cancelled`.
  - Demo principal's `userId` = `userRepository.upsertDemoUser()` id (cache it after first call).
  - Interviewer lookup uses the existing `userRepository.findIdentityByClerkId(clerkId)`; with no `User` row → `createFromClerk` with `fetchUser` data (email fallback `${clerkId}@talentiq.dev`, as the old upsert).
  - `fromRequest` reads `Authorization: Bearer …` and `x-invite-token`.
- `authenticate(resolver)` → middleware: sets `req.principal` or `UnauthorizedError("Unauthorized")`; resolver errors → `InternalError("Auth error")`.
- `requireKind(...kinds)` → middleware: `req.principal.kind` not in kinds → `AppError(403, "Forbidden")`.

- [ ] **Step 1: failing tests** (fakes for verifier/repos): valid demo token → demo principal; valid Clerk token, existing user → interviewer principal; **`provisions a missing user from Clerk`** (createFromClerk called with fetched data); bad bearer → null; invite matching hash → candidate principal with that `interviewId`; **`refuses an invite once the interview is completed`**; no credentials → null; `x-clerk-id` header alone → null (old path gone); `requireKind("interviewer","demo")` with candidate → 403 `{ message: "Forbidden" }`.
- [ ] **Step 2–4:** FAIL → implement → PASS (old auth tests deleted with their files).
- [ ] **Step 5:** Commit `feat(auth): identity resolver and middleware`.

### Task 4: Container, app wiring and the demo endpoint

**Files:** Modify `backend/src/container.js`, `backend/src/app.js`, `backend/src/tests/testApp.js`; Create `backend/src/controllers/auth.controller.js`, `backend/src/routes/auth.routes.js`; Test `backend/src/tests/auth.test.js`

**Interfaces:**
- `createContainer({ config, prisma, clerkVerifier?, now?, generation?, getStreamClient? })` — the `identityStrategy` override is replaced by `clerkVerifier` (default `createClerkVerifier({ ...config.clerk, authorizedParties: [config.clientUrl] })`). Container exposes `auth: { resolver, demoTokens }`.
- `buildTestApp({ prisma, clerkVerifier = fakeClerkVerifier(), … })`; export helpers from `testApp.js`: `fakeClerkVerifier(users = { "clerk_A": {...} })` (token `"clerk:<clerkId>"` verifies to that id), `demoBearer(container) → Promise<string>`, `inviteFor(secret)`.
- `POST /api/auth/demo` → 200 `{ token, expiresAt }`; limited 20 / 15 min / IP (`express-rate-limit`, same JSON 429 shape as `app.js`; limit overridable via `createApp` options `demoRateLimit`).
- `app.js` mounts `/api/auth` **without** `authenticate`; every other `/api` router is mounted behind `authenticate(container.auth.resolver)`. `/api/sessions` (coding problems) stays open to **any** principal, candidates included (no `requireKind`).

- [ ] **Step 1: failing tests** — `POST /api/auth/demo` returns a token that `demoTokens.verify` accepts and an ISO `expiresAt`; 21st call in the window → 429; `GET /api/sessions` without credentials → 401 `{ message: "Unauthorized" }`; with demo bearer → 200; `/health` still open.
- [ ] **Step 2–4:** FAIL → implement → PASS. Existing contract tests now need credentials: give `buildTestApp` callers a demo or Clerk bearer (helpers above). Ownership assertions come in Task 5 — here only make them authenticate.
- [ ] **Step 5:** Commit `feat(auth): authenticate every /api route; demo token endpoint`.

### Task 5: Interviews — ownership, per-caller stats, demo delete

**Files:** Modify `services/interview.service.js`, `controllers/interview.controller.js`, `routes/interview.routes.js`, `repositories/interview.repository.js`, `validators/interview.schemas.js`; Test `backend/src/tests/interviews.test.js` (rewrite ownership parts), `backend/src/tests/access.test.js` (new, the spec's access table)

**Interfaces:**
- `createInterviewService({ interviewRepository })` (no more `resolveInterviewerId`). Methods take the principal first: `list(principal)`, `create(principal, body)`, `get(principal, id)`, `updateStatus(principal, id, status)`, `update(principal, id, body)`, `remove(principal, id)`, `dashboardStats(principal)`, `recentActivity(principal)`, `createInvite(principal, id) → { url }`, `roomView(principal, id)`.
- Ownership: `interview.interviewerId === principal.userId`, else `NotFoundError("Interview not found")`. `remove` by demo → `AppError(403, "Not allowed in demo mode")` (checked before ownership).
- `create` ignores body `interviewerId`/`interviewerClerkId` and the `x-clerk-id` header (drop them from the schema too).
- Repository: `findMany({ interviewerId })`, `countDashboardStats(userId)` (no `totalUsers`), `findRecent(take, userId)`, `setInviteHash(id, hash)` (also sets `inviteCreatedAt: new Date()`).
- `dashboardStats` returns `{ total, completed, live, scheduled, cancelled, avgDuration }`.
- Routes: all behind `requireKind("interviewer", "demo")` except `GET /:id/room` (any principal). New: `POST /:id/invite` → 200 `{ url }` built from `config.clientUrl` (pass `clientUrl` to the service factory).
- `roomView`: owner → `toInterviewDoc(full)`; candidate with matching `interviewId` → `{ _id, candidateName, role, interviewType, scheduledAt, duration, status, codeLanguage, codeSnapshot, viewer: "candidate" }`; other candidate → 404.

- [ ] **Step 1: failing tests** (`access.test.js`, interviewer A `clerk_A`, interviewer B `clerk_B`, demo, candidate of A's interview): A lists only A's; B `GET /api/interviews/<A's id>` → 404; B `PATCH`/`DELETE` A's → 404; candidate `GET /api/interviews` → 403; candidate `GET /api/interviews/<id>/room` → body has no `questions`/`notes` keys and `viewer: "candidate"`; candidate on another interview's `/room` → 404; demo `DELETE` own → 403 `{ message: "Not allowed in demo mode" }`; `POST /:id/invite` by owner → `url` matches `^http://localhost:5174/room/<id>#invite=[A-Za-z0-9_-]{43}$` and stored hash equals `hashInviteSecret(secret)`; regenerating changes the hash; stats response has no `totalUsers`.
- [ ] **Step 2–4:** FAIL → implement → PASS (update `interviews.test.js` service unit tests to the principal signatures).
- [ ] **Step 5:** Commit `feat(auth): interview ownership, candidate room view, invites`.

### Task 6: Users — `/me`

**Files:** Modify `services/user.service.js`, `controllers/user.controller.js`, `routes/user.routes.js`, `validators/user.schemas.js`; Test `backend/src/tests/users.test.js`

**Interfaces:** `createUserService({ userRepository })` → `{ getMe(principal), updateMe(principal, body), getMyStats(principal) }` (`listUsers`, `createUser`, `getByClerkId`, `resolveInterviewerId` removed; demo upsert lives in the resolver now). Routes: `GET /me`, `PUT /me`, `GET /me/stats`, behind `requireKind("interviewer", "demo")`. `updateMe` keeps today's defaults/messages; email defaults to the existing row's email.

- [ ] **Step 1: failing tests** — `GET /api/users/me` as A returns A's profile; `PUT /api/users/me` as A changes only A (B unchanged); `GET /api/users` → 404; `GET /api/users/by-clerk/clerk_B` → 404; candidate `GET /api/users/me` → 403.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(auth): users scoped to the caller (/me)`.

### Task 7: Questions and Stream

**Files:** Modify `services/question.service.js`, `controllers/question.controller.js`, `routes/question.routes.js`, `services/stream.service.js`, `controllers/stream.controller.js`, `routes/stream.routes.js`, `validators/stream.schemas.js`, `container.js`; Test `backend/src/tests/questions.test.js`, `backend/src/tests/stream.test.js`

**Interfaces:**
- `createQuestionService({ interviewRepository, generation, rateLimiter, demoRateLimiter, config })`; `generate(principal, interviewId)`, `approve(principal, interviewId, body)`; both 404 unless owner. Limiter key: demo → `demoRateLimiter.check("demo")` (5/h), interviewer → `rateLimiter.check(principal.userId)` (10/h). Routes behind `requireKind("interviewer","demo")`.
- `createStreamService(...)`: `createUserToken(principal) → { token, userId }` with `userId` = `clerkId` (interviewer), `demo-<8 random hex>` (demo), `candidate-<interviewId>-<8 random hex>` (candidate). `?userId=` ignored (schema removed). Route open to any principal.

- [ ] **Step 1: failing tests** — 6th demo generation within the hour → 429 even from "different" demo tokens; B generating on A's interview → 404; candidate generate → 403; stream as candidate returns `userId` starting `candidate-<id>-`; stream ignores `?userId=evil`.
- [ ] **Step 2–4:** FAIL → implement → PASS (port the 12 existing question cases to send an owner bearer).
- [ ] **Step 5:** Commit `feat(auth): questions and stream tokens use the principal`.

### Task 8: Socket.io authentication

**Files:** Create `backend/src/realtime/authenticateSocket.js`; Modify `realtime/index.js`, `realtime/handlers/joinRoom.js`, `realtime/handlers/questionChange.js`, `server.js`; Test `backend/src/realtime/handlers.test.js`, `backend/src/realtime/authenticateSocket.test.js`

**Interfaces:**
- `createSocketAuthenticator(resolver)` → Socket.io middleware `(socket, next)`: reads `socket.handshake.auth` `{ token?, invite? }`, sets `socket.data.principal`, else `next(new Error("Unauthorized"))`.
- `attachRealtime({ …, authenticator, canAccessRoom })`; `canAccessRoom(principal, roomId) → Promise<boolean>`: candidate → `roomId === principal.interviewId`; owner kinds → `interviewRepository.findById(roomId)?.interviewerId === principal.userId`.
- `joinRoom`: refused (no join, emits `error-message` `"Forbidden"`) when `canAccessRoom` is false. `questionChange`: ignored for candidates.

- [ ] **Step 1: failing tests** — authenticator rejects empty auth; accepts demo token; **candidate `join-room` with another interview id is refused** (socket not in that room, no snapshot emitted); candidate `question-change` → no emit; owner flow unchanged (existing handler tests pass with an owner principal in `socket.data`).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Manual: `node <scratchpad>/socket-smoke.mjs` updated to pass a demo token (fetch `POST /api/auth/demo` first) → relay still works; without token → connect_error.
- [ ] **Step 6:** Commit `feat(auth): authenticate Socket.io and guard rooms`.

### Task 9: Frontend credentials and API client

**Files:** Create `frontend/src/lib/api.ts`, `frontend/src/lib/credentials.tsx`; Modify `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/.env.example` (`VITE_API_URL=`)

**Interfaces — Produces:**
- `API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001"`.
- `<CredentialsProvider>` (inside `ClerkProvider`) exposing `useCredentials()` → `{ mode: "clerk" | "demo" | "candidate" | "none", getAuthHeaders(): Promise<Record<string,string>>, socketAuth: (cb) => void, enterDemo(): Promise<void>, leaveDemo(): void, setInvite(interviewId, secret): void }`. Clerk: `getToken()` on every call. Demo: token from `sessionStorage["talentiq.demoToken"]` (with `expiresAt`; expired → cleared, back to sign-in). Candidate: `sessionStorage["talentiq.invite.<id>"]` → `x-invite-token`.
- `useApi()` → `apiFetch(path, init?)` = `fetch(API_URL + path, …)` with `getAuthHeaders()` merged; on 401 in demo mode → `leaveDemo()`.
- `App.tsx`: `isDemo` state replaced by `mode === "demo"`; "Continue as Guest" → `enterDemo()`; new public route `/room/:id` → `CandidateRoom` (Task 11) outside the signed-in gate.

- [ ] **Step 1:** Implement; `npm run build` → green.
- [ ] **Step 2:** Commit `feat(auth): frontend credentials context and API client`.

### Task 10: Frontend pages use the API client

**Files:** Modify `pages/Dashboard.tsx`, `Interviews.tsx`, `NewInterview.tsx`, `Schedule.tsx`, `Profile.tsx`, `InterviewRoom.tsx`, `components/QuestionsPanel.tsx`, `components/CollaborativeEditor.tsx`

- Every `fetch('http://localhost:3001…')` → `apiFetch('/api/…')`. Remove `x-clerk-id` headers, `interviewerId` in the create body, `?interviewerId=` in Profile.
- Profile: `/api/users/me`, `/api/users/me/stats`, `/api/interviews` (already scoped).
- Dashboard: drop the "Total Users" card (spec call).
- `CollaborativeEditor`: `io(API_URL, { auth: socketAuth })`; show "Forbidden"/connect errors in the status bar instead of "Connected & Live".
- `InterviewRoom`: stream token via `apiFetch('/api/stream/token')`, join Stream with the returned `userId`; add an **"Invite candidate"** button (owner only) → `POST /api/interviews/:id/invite`, copy URL to clipboard, show it with a "Regenerate" action.

- [ ] **Step 1:** Implement; `npm run build` green; `npm run lint` → no new errors vs baseline count.
- [ ] **Step 2: Manual (Review Focus 1):** demo mode: dashboard loads; open room; leave tab idle 2 minutes; type in editor and ask a question → still works. Real Clerk sign-in: same.
- [ ] **Step 3:** Commit `feat(auth): pages send verified credentials`.

### Task 11: Candidate room page

**Files:** Create `frontend/src/pages/CandidateRoom.tsx`; Modify `InterviewRoom.tsx` / `CollaborativeEditor.tsx` (extract or prop `viewer: "interviewer" | "candidate"`, builder's call)

- On mount: read `#invite=` from `location.hash`, `setInvite(id, secret)`, `history.replaceState(null, "", location.pathname)`. No secret and none stored → "This link is invalid or expired" screen.
- Loads `GET /api/interviews/:id/room`; renders video, Code Editor + System Design tabs, current-question banner. No QuestionsPanel, no End Session report, no dashboard chrome.
- 401/404 from `/room` → the same invalid-link screen.

- [ ] **Step 1:** Implement; `npm run build` green.
- [ ] **Step 2: Manual:** interviewer (Clerk or demo) clicks "Invite candidate", opens the URL in a private window → candidate room loads, network tab shows no `questions` in any response, the URL bar no longer shows `#invite=`; interviewer clicks Ask → candidate sees the question; interviewer regenerates → candidate refresh shows the invalid-link screen.
- [ ] **Step 3:** Commit `feat(auth): candidate room`.

### Task 12: Docs and final verification

**Files:** Modify `CLAUDE.md` (Auth section: principals, `/api/auth/demo`, invite links, `/me`, socket auth; remove `x-clerk-id` text)

- [ ] **Step 1:** `cd backend && npm test` → all green; `cd frontend && npm run build` → green.
- [ ] **Step 2:** `grep -rn "x-clerk-id\|by-clerk\|localhost:3001" frontend/src backend/src` → only `API_URL`'s default.
- [ ] **Step 3:** Live: unauthenticated `curl /api/interviews` → 401; `/health` → 200.
- [ ] **Step 4:** Commit `docs(auth): update CLAUDE.md`; then superpowers:finishing-a-development-branch.
