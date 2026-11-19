# Backend hardening (deps, Zod request validation, HTTP security) — short design

Date: 2026-11-19 · Branch: `refactor/backend-layers` · Approved by the user ("oui vas-y dans cet ordre").

## Intent
Close the gaps found in the post-refactor review that don't depend on real auth: vulnerable/unused dependencies, request validation at the HTTP boundary, and HTTP-level protections. Auth (OAuth, ownership) is the next, separate project.

## Goals / non-goals
- Goals: (1) drop unused `inngest` and `talent-iq` deps and run a non-breaking `npm audit fix`; (2) validate request body/params/query with Zod at the route boundary; (3) `helmet` security headers + a global per-IP rate limit on `/api`.
- Non-goals: Prisma 7 / Zod 4 major upgrades; auth; frontend changes.
- Anti-goal: rejecting anything the frontend sends today, or changing any existing error message.

## Approach (my calls)
1. **Deps** — `npm uninstall inngest talent-iq` (no source file imports them), then `npm audit fix` without `--force`. Accept whatever remains only if it needs a major bump; list it.
2. **Validation** — `shared/validate.js` exports `validate({ body, params, query })`: an Express middleware that `safeParse`s each given part and on failure throws `ValidationError(<first issue message>)`. It validates only (no reassignment — Express 5 `req.query` is read-only). Schemas live in `validators/<feature>.schemas.js`; each field carries the **existing** message (e.g. `"Missing required interview fields"`, `"Invalid status"`, `"Name is required"`, `"jobId (string) and approved (boolean) are required"`, `"User ID is required"`). Optional profile fields accept `null` (the Profile page sends them). Unknown keys are allowed (not stripped, not rejected). Services keep their own rule checks (defence in depth for non-HTTP callers); Zod adds type checks that previously surfaced as Prisma 500s (e.g. `candidateName: 42`, `duration: "abc"`, `notes: {}`) — those now answer 400.
3. **HTTP security** — `helmet()` defaults (API-only server; CORP/CSP don't affect CORS fetches or Socket.io), `x-powered-by` gone. `express-rate-limit` on `/api`: 1000 requests / 15 min per IP, JSON 429 `{ message: "Too many requests, please try again later" }`, standard `RateLimit-*` headers. `/health` is not limited. Limits are `createApp` options so tests can lower them.

## Verification
TDD per step; full suite green; live API diff vs baseline unchanged; browser smoke (dashboard, profile save, interview room).
