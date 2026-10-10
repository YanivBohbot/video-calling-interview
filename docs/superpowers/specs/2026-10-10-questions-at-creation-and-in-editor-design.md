# Questions at Creation + Current Question in the Editor — Design

**Date:** 2026-10-10
**Status:** Approved in conversation
**Builds on:** `2026-10-10-question-generator-langgraph-pipeline-design.md`, `2026-10-10-role-catalog-and-leetcode-sources-design.md` (same branch).

## 1. Why

The user wants interview questions prepared **when the interview is created**, not discovered later in the room. They also want the questions to show up **in the code editor** during the interview, where the candidate is working. Today:
- generation only exists in the interview room's Questions tab;
- the questions are never shown in the Code tab;
- the candidate never sees them.

## 2. Decisions (from the conversation)

- **Where to generate:** on New Interview's confirmation screen, right after **Schedule**, the interview already exists, so the existing generate → review/edit → approve pipeline is reused unchanged. This step is optional, and the room's Questions tab still works for later edits.
- **How questions appear in the editor:** an interviewer-only **Questions** column beside the editor lists the approved questions, each with an **Ask** button. Asking makes that question the room's **current question**, shown in a banner above the editor to both people and synced live.

## 3. Goals / Non-goals

**Goals**
- Generate, review and approve questions on the confirmation screen, with the same LeetCode badges and approve/discard behaviour as the room.
- In the Code tab, the interviewer sees the approved list and can Ask any question.
- Everyone in the room sees the current question. It survives a page refresh or a late join while the room is active.
- The LeetCode source (title and link) is never sent to the candidate. Only the interviewer's banner and list show the badge.

**Non-goals**
- A Prisma migration to persist the current question. It lives in server memory and resets when the room empties or the server restarts; the interviewer just Asks again.
- Authenticating socket events. The existing socket model is unauthenticated (see `CLAUDE.md`), so a modified candidate client could emit `question-change`. This is accepted, same as `code-change`.
- Candidate-side navigation through the question list.

## 4. Backend

**New module `backend/src/lib/roomQuestions.js`** (pure, unit-tested):
- `sanitizeAskedQuestion(raw)` → `{ index, text, category, difficulty }` or `null`. Rules:
  - `index`: an integer ≥ 0.
  - `text`: a non-empty string, cut to 2000 characters.
  - `category` and `difficulty`: from the existing enums.
  - Anything else, `source` included, is dropped.
- `setCurrentQuestion(map, roomId, question)` and `getCurrentQuestion(map, roomId)`.

**`server.js` socket wiring:**
- `roomQuestions` is a separate `Map`. It is deliberately **not** stored in the code `roomState` entries: creating one of those entries makes a rejoining client receive `""` instead of the persisted code snapshot.
- `join-room`: if the room has a current question, emit `question-update` to the joiner. This happens before the existing code-snapshot logic (which can `return` early).
- `question-change { roomId, question }`: ignored unless the socket is in the room and the payload sanitizes. The question is stored, then `io.to(roomId).emit("question-update", clean)`, so every participant, including the sender, gets the same sanitized object.
- `disconnect`: when the room becomes empty, its current question is deleted, alongside the existing flush-on-exit.

## 5. Frontend

- **Shared types** in `frontend/src/lib/questions.ts`: `Question`, `QuestionSource`, `AskedQuestion`.
- **`QuestionsPanel` component** moved from `InterviewRoom.tsx` into `frontend/src/components/QuestionsPanel.tsx`, with the same props and behaviour. `InterviewRoom` imports it.
- **New Interview confirmation screen:** a "Generate questions (optional)" section renders `QuestionsPanel` for `created._id`. Clerk id is `user?.id ?? 'demo'`, matching how the interview was created. It keeps its own questions / jobId / saved-list state.
- **`CollaborativeEditor`** gains one prop, `askableQuestions?: Question[]`:
  - **When set (interviewer):** renders a left column (~240px) listing the questions — number, category/difficulty, first line of text, LeetCode badge if sourced, and an **Ask** button. Ask emits `question-change` with `{ index, text, category, difficulty }`.
  - **Always:** listens for `question-update` and renders a **Current question** banner above the editor showing the text and category · difficulty. The interviewer's banner adds the LeetCode badge by looking up `askableQuestions[index].source` locally.
  - **When `askableQuestions` is unset (candidate):** no column and no badge.
- **`InterviewRoom`** passes `askableQuestions={isInterviewer ? interviewData?.questions ?? [] : undefined}`. Approving new questions in the Questions tab updates this list.

## 6. Error handling
- A malformed `question-change` payload is silently ignored by the server and not broadcast.
- No approved questions: the interviewer's column says "No approved questions yet — generate them on the Questions tab."
- No current question yet: the banner is hidden for the candidate; for the interviewer it reads "Click Ask on a question to show it to the candidate."

## 7. Testing
- Backend unit: `sanitizeAskedQuestion` (valid, strips source, bad index/category/text, truncation) and the map get/set.
- Live socket check: two `socket.io-client` connections join the same room, one emits `question-change`, and both receive the sanitized `question-update` without `source`. A third client joining later receives it on join. A malformed payload is not broadcast.
- Frontend: there is no test runner, so `npm run build` plus lint at baseline, then a headless-browser walkthrough in guest mode: create interview → generate → approve on the confirmation screen → open room → Code tab shows the list → Ask → banner appears, including in a second page.
