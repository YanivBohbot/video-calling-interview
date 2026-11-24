# Factory backlog

Queue for `/factory next`. One feature per line, checked off when a job starts.

- [ ] Fix the unused `error` variable lint error in the catch block of `frontend/src/components/CollaborativeEditor.tsx` (line 82) without swallowing the error silently — log it or surface it to the user.
- [ ] Replace the `any` types in `frontend/src/layouts/DashboardLayout.tsx` (line 17) and `frontend/src/pages/InterviewRoom.tsx` (lines 131, 158, 249) with proper types, without changing runtime behavior.
- [ ] Wire `backend/src/middlewares/protectRoute.js` onto `interview.routes.js`, `user.routes.js`, and `session.routes.js` instead of the ad-hoc header parsing duplicated in individual controller functions, preserving the existing `x-clerk-id` / `Authorization: Bearer user:<clerkId>` / demo-user behavior documented in `CLAUDE.md`.
