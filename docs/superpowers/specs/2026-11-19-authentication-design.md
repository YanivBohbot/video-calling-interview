# Authentication & access control — design

Date: 2026-11-19 · Branch: `refactor/backend-layers` (or a branch stacked on it) · Status: approaches chosen by the user (1A, 2A, 3A); awaiting approval of this document.

## Intent

Today the backend trusts whatever identity the browser claims: `x-clerk-id` (or `Bearer user:<id>`) is never verified, most routes are open, and nothing checks who owns what. Anyone can read, edit or delete any interview, any profile, mint a Stream video token for any user id, and — because the room page loads `GET /api/interviews/:id` — a candidate can read every AI-prepared question (with its LeetCode source) in the network tab before the interview starts.

The user keeps **Clerk** for sign-in (Clerk already does OAuth 2.0 / OpenID Connect with Google, GitHub, etc.); what's missing is the backend **verifying** identities and **enforcing** access. Three kinds of visitor must work:

| Visitor | How they arrive | What they may do |
|---|---|---|
| **Interviewer** | signs in with Clerk | everything, but only on **their own** interviews and profile |
| **Candidate** | opens the room link from an invitation | only the interview room of **that** interview: video, editor, "Run", sees a question **only when the interviewer clicks Ask**; no dashboard, no AI panel, no question list |
| **Demo visitor** | clicks "Continue as Guest" | the full interviewer experience (incl. AI generation), but only on the shared **demo** account's data, with a tighter AI limit. Used by the user to show the app during their own job interviews |

## Goals

- Every `/api` route and every Socket.io connection is authenticated, except `GET /health` and `POST /api/auth/demo`.
- Interviewers and the demo visitor can only read/modify interviews they own; the user list, profiles and stats are scoped to the caller.
- Candidates get a reduced room view that **never contains the questions list**, and can't trigger question changes.
- The guest/demo flow keeps working in one click; its identity is server-issued, not a forgeable header.
- The interview page shows the candidate link so the user can demo interviewer and candidate side by side.

## Non-goals

- Sending the invitation e-mail (separate project, right after this one). Here the interviewer copies the link.
- Roles beyond these three (no admin), MFA, Clerk webhooks.
- Resetting demo data automatically.
- Prisma 7 / Zod 4 upgrades.

## Anti-goals (failure even if it "works")

- A candidate being able to obtain the question list or LeetCode sources through any API or socket event.
- One interviewer seeing or changing another interviewer's interviews, notes or profile.
- Breaking the one-click demo the user relies on in job interviews.
- Logging or returning tokens/secrets.

## Approaches (chosen)

1. **Interviewer verification — `@clerk/express` (chosen)** over hand-rolled JWT verification with `jose` against Clerk's JWKS. The SDK handles key rotation and clock skew; the hand-rolled route only pays off if Clerk were dropped, which is no longer planned.
2. **Candidate link — per-interview secret stored hashed (chosen)** over a stateless signed link. A stored secret can be **regenerated** to kill a link sent to the wrong address; a signed link can't be revoked before it expires. Rejected outright: making candidates create Clerk accounts (too much friction for someone opening a link).
3. **Demo — backend-issued signed token (chosen)** over a shared real Clerk account logged in via Clerk sign-in tokens: same result, far less setup, and the demo stays independent of Clerk configuration.

## Design

### Identity model

`auth/` resolves every request (and socket handshake) to one **principal**:

```
{ kind: "interviewer", userId, clerkId }          // verified Clerk session
{ kind: "demo",        userId, clerkId: "demo" }  // verified demo token
{ kind: "candidate",   interviewId }              // verified invite secret, scoped to one interview
```

A composite identity strategy tries, in order: `Authorization: Bearer <token>` → Clerk session JWT, else demo JWT; else an `x-invite-token` header (candidate). No credential → no principal. The old `x-clerk-id` / `Bearer user:<id>` paths are **removed**.

- **Interviewer**: `@clerk/express` verifies the Clerk session token (signature, expiry, authorized party = the frontend origin). The Clerk user id (`sub`) maps to `User.clerkId`. **If no `User` row exists yet, it is created on first request** from Clerk's user record (name, primary e-mail, image) fetched once with the Clerk backend client — today a new Clerk user can't create an interview until they've saved their profile.
- **Demo**: `POST /api/auth/demo` (no auth, rate-limited) upserts the existing `"demo"` user (as `resolveInterviewerId("demo")` does today) and returns `{ token, expiresAt }` — a JWT signed HS256 with a new `DEMO_TOKEN_SECRET`, `sub: "demo"`, `aud: "talentiq-demo"`, 8 h expiry. Verified with `jose`.
- **Candidate**: see "Candidate link".

### Access rules

| Route | Interviewer / demo | Candidate | No principal |
|---|---|---|---|
| `POST /api/auth/demo` | — | — | ✅ |
| `GET /api/interviews`, `/stats`, `/activity` | own interviews only (stats/activity computed over own interviews) | ❌ 403 | ❌ 401 |
| `POST /api/interviews` | interviewer = caller (body/header interviewer ids ignored) | ❌ | ❌ |
| `GET/PATCH/DELETE /api/interviews/:id` (+ `/status`) | only if owner, else **404** (don't reveal existence) | ❌ | ❌ |
| `POST /api/interviews/:id/questions/*` | owner only; demo uses a stricter AI limit | ❌ | ❌ |
| `GET /api/interviews/:id/room` (new) | full room data if owner | reduced view if invite matches `:id` | ❌ |
| `POST /api/interviews/:id/invite` (new) | owner: generate/regenerate link → returns the URL once | ❌ | ❌ |
| `GET /api/users` | ❌ removed (no page uses it) | ❌ | ❌ |
| `POST /api/users` | ❌ removed (users are provisioned from Clerk) | ❌ | ❌ |
| `GET/PUT /api/users/me`, `GET /api/users/me/stats` (replace `/by-clerk/:clerkId`) | own profile | ❌ | ❌ |
| `GET /api/sessions`, `/:id` | ✅ | ✅ (coding problems are not secret) | ❌ |
| `GET /api/stream/token` | token for `user_id = clerkId` (demo: `demo-<random>`, as today) | token for `candidate-<interviewId>-<random>` | ❌ |

The Stream `user_id` is now **derived by the backend from the principal**; the `?userId=` query parameter is ignored (the response adds `{ userId }` so the frontend joins the call with the same id).

"Global" dashboard numbers (`totalUsers`, all interviews) become per-caller: the dashboard shows the caller's own figures. `totalUsers` is dropped from the response (the frontend card is removed or shows "—"; builder's call).

Room views:
- **Owner view** = today's `GET /api/interviews/:id` shape (Mongo-shaped, includes `questions`).
- **Candidate view** = `{ _id, candidateName, role, interviewType, scheduledAt, duration, status, codeLanguage, codeSnapshot, role: "candidate" }` — no `questions`, no `notes`, no interviewer e-mail.

Status codes: no/invalid credential → 401 `{ message: "Unauthorized" }`; right identity, wrong kind (candidate on an interviewer route) → 403 `{ message: "Forbidden" }`; not the owner → 404 with the resource's usual not-found message.

### Candidate link

- New columns on `Interview`: `inviteTokenHash String? @unique`, `inviteCreatedAt DateTime?` (Prisma migration).
- `POST /api/interviews/:id/invite` (owner) creates 32 random bytes (`crypto.randomBytes`, base64url), stores its SHA-256, returns `{ url: "<CLIENT_URL>/room/<id>?invite=<secret>" }`. Calling it again replaces the secret (old link dies). The secret is never stored or logged in clear and can't be read back — the UI shows it right after generation and offers "Regenerate".
- A candidate request carries `x-invite-token: <secret>`; the backend hashes it and matches `inviteTokenHash` **and** the `:id` in the route. Constant-time comparison is unnecessary (lookup by unique hash).
- Links don't expire on a timer (interviews get rescheduled); they die on regeneration, on interview deletion, and are refused when the interview status is `completed` or `cancelled`.

### Socket.io

- The client passes its credential in the handshake: `io(url, { auth: { token } })` or `{ auth: { invite, interviewId } }`. A connection middleware resolves the principal (same strategies) and rejects unauthenticated connections.
- `join-room` only succeeds for a room the principal may access (owner's interview, or the candidate's own interview). The demo `"default"` room id the frontend may use is not special-cased: unknown/unowned rooms are refused.
- `question-change` is accepted only from interviewer/demo owners; candidates receive `question-update` only.
- `code-change`, `language-change`, `code-execution` stay allowed for both sides.

### Frontend

- `src/lib/api.ts`: one `apiFetch(path, options)` using `VITE_API_URL` (default `http://localhost:3001`) that attaches the current credential: Clerk `getToken()` when signed in, the stored demo token in demo mode, or the invite secret in candidate mode. Every existing `fetch('http://localhost:3001/…')` goes through it; the Socket.io client uses the same URL and credential.
- Demo: "Continue as Guest" calls `POST /api/auth/demo` and keeps the token in `sessionStorage` (so a page refresh no longer drops demo mode — today's `isDemo` state is lost on refresh). Leaving demo mode clears it.
- New public route `/room/:id?invite=…` renders a **candidate room**: video + editor + current question banner; no AI panel, no question list, no "End Session" report, no dashboard chrome. It keeps both tabs (Code Editor and System Design whiteboard). It is reachable without Clerk sign-in. The interviewer's room stays at `/interview/:id` and keeps using `GET /api/interviews/:id`; only the candidate page uses `GET /api/interviews/:id/room`.
- Interviewer room: an "Invite candidate" control that generates/regenerates and copies the link.
- Profile page uses `/api/users/me` instead of `/by-clerk/:clerkId`; other pages drop `interviewerId`/`x-clerk-id` plumbing.

### Configuration

New backend env: `CLERK_SECRET_KEY` (required — already present by name today), `CLERK_PUBLISHABLE_KEY` (required by `@clerk/express`), `DEMO_TOKEN_SECRET` (required, ≥ 32 chars). Frontend: `VITE_API_URL` (optional). `loadConfig` validates these by name only (never echoes values). `.env.example` files list the names with empty values.

### Rate limits

- `POST /api/auth/demo`: 20 per 15 min per IP.
- AI generation: interviewer 10/h per user (unchanged); **demo 5/h in total** (one shared key).
- Global `/api` limit unchanged (1000 / 15 min / IP).

## Testing

- Unit: each strategy (valid / expired / wrong audience / tampered token; invite hash match / mismatch / completed interview), principal → permission checks per route class.
- HTTP contract (Supertest over `buildTestApp`, Clerk verification injected as a fake so tests need no network): the access-rules table above, row by row, incl. "interviewer B gets 404 on A's interview", "candidate gets 403 on `/api/interviews`", "candidate room view has no `questions` key".
- Socket: handshake without credential refused; candidate can't `question-change`; candidate can't join another interview's room.
- Manual: two browsers — real Clerk interviewer creates interview, generates questions, copies invite link; candidate window opens it, sees no AI panel, receives the asked question; demo flow end-to-end; refresh keeps demo mode.

## Calls made by the designer (not discussed with the user — check these)

- Dashboard numbers become **per-caller** (own interviews), and "Total users" is dropped: a platform-wide count leaks other customers' activity.
- Not-owner answers **404**, not 403, so interview ids can't be probed.
- `GET /api/users` and `POST /api/users` are **removed** (no frontend page calls them; users are provisioned from Clerk on first request).
- Invite links have **no timer**; they die on regeneration, deletion, or when the interview is completed/cancelled.
- The demo token lives **8 h** in `sessionStorage` (survives refresh, not a closed tab).
- Demo AI generation: **5 per hour in total**.

## Left to the builder

- Exact file names inside `auth/`, how the composite strategy is wired in `container.js`.
- Frontend component split for the candidate room (reuse the editor/video components with a `role` prop vs a separate page).
- Wording of new UI labels and of the empty "Total users" card.
- Order of migration (backend first behind the new strategies, then frontend switch, then removal of old header paths) as long as each step keeps the suite green.
