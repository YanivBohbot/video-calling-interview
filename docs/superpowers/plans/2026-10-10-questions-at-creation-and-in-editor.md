# Questions at Creation + Current Question in the Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen: native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the interviewer generate and approve questions right after scheduling an interview. In the room's Code tab, they can then "Ask" a question, which shows as a live "current question" banner above the editor for everyone, with the LeetCode source shown only to the interviewer.

**Architecture:**
- **Backend:** a pure `roomQuestions.js` module sanitizes the asked question and stores it per room in a separate in-memory map. `server.js` wires `question-change` / `question-update` socket events and replays the current question on `join-room`.
- **Frontend:**
  - `QuestionsPanel` becomes a shared component, used by the New Interview confirmation screen.
  - `CollaborativeEditor` gains an optional `askableQuestions` prop (interviewer list + Ask), plus the banner.

**Tech Stack:** Express 5, Socket.io 4, Vitest; React 19 + TS + Tailwind, socket.io-client, Monaco.

**Spec:** `docs/superpowers/specs/2026-10-10-questions-at-creation-and-in-editor-design.md`

## Global Constraints
- No Prisma migration. The current question lives only in server memory.
- The socket payload is exactly `{ index, text, category, difficulty }`; `source` never goes over the socket.
- The current question is stored in its own `Map`, never in the code `roomState` entries (those would replay `""` code to rejoiners).
- Backend baseline: `npm test` → 98/98. Frontend lint baseline: 5 errors / 2 warnings.

## Review Focus
- A candidate's browser receives a `question-update` that includes `source` → must never happen (Task 1 sanitize test; Task 5 live socket check).
- `question-change` from a socket that never joined the room, or with a malformed payload → ignored, not broadcast (Task 2 wiring; Task 5 live check).
- A participant joins or refreshes after Ask → still sees the current question (Task 2; Task 5).
- Approving new questions in the Questions tab mid-interview → the Code-tab list updates without a reload (Task 4 uses `interviewData.questions`, which `onSaved` updates).
- An interview with no approved questions → the interviewer column shows a helpful empty state, and the editor works as before (Task 4).

---

### Task 1: `roomQuestions` module (backend, TDD)

**Files:** Create `backend/src/lib/roomQuestions.js`, `backend/src/lib/roomQuestions.test.js`.

**Produces:** `sanitizeAskedQuestion(raw) → {index,text,category,difficulty} | null`, `setCurrentQuestion(map, roomId, q)`, `getCurrentQuestion(map, roomId)`, `clearCurrentQuestion(map, roomId)`.

- [ ] Step 1 — failing tests:

```js
import { describe, it, expect } from "vitest";
import { sanitizeAskedQuestion, setCurrentQuestion, getCurrentQuestion, clearCurrentQuestion } from "./roomQuestions.js";

const good = { index: 1, text: "Rank players by score", category: "technical", difficulty: "medium" };

describe("sanitizeAskedQuestion", () => {
  it("keeps only index, text, category and difficulty — never the LeetCode source", () => {
    const clean = sanitizeAskedQuestion({ ...good, source: { url: "https://leetcode.com/problems/rank-scores/" }, extra: 1 });
    expect(clean).toEqual(good);
  });

  it.each([
    ["a negative index", { ...good, index: -1 }],
    ["a fractional index", { ...good, index: 1.5 }],
    ["empty text", { ...good, text: "   " }],
    ["non-string text", { ...good, text: 42 }],
    ["an unknown category", { ...good, category: "trivia" }],
    ["an unknown difficulty", { ...good, difficulty: "extreme" }],
    ["null", null],
  ])("rejects %s", (_label, raw) => {
    expect(sanitizeAskedQuestion(raw)).toBeNull();
  });

  it("caps very long text at 2000 characters", () => {
    expect(sanitizeAskedQuestion({ ...good, text: "x".repeat(5000) }).text).toHaveLength(2000);
  });
});

describe("current question store", () => {
  it("sets, gets and clears per room", () => {
    const map = new Map();
    expect(getCurrentQuestion(map, "room-1")).toBeUndefined();
    setCurrentQuestion(map, "room-1", good);
    expect(getCurrentQuestion(map, "room-1")).toEqual(good);
    expect(getCurrentQuestion(map, "room-2")).toBeUndefined();
    clearCurrentQuestion(map, "room-1");
    expect(getCurrentQuestion(map, "room-1")).toBeUndefined();
  });
});
```

- [ ] Step 2 — run `npx vitest run src/lib/roomQuestions.test.js` → FAIL (module missing).
- [ ] Step 3 — implement:

```js
const CATEGORIES = new Set(["technical", "behavioral", "system-design"]);
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const MAX_TEXT = 2000;

// Only what the candidate may see crosses the socket: no LeetCode source, no extras.
export const sanitizeAskedQuestion = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const { index, text, category, difficulty } = raw;
  if (!Number.isInteger(index) || index < 0) return null;
  if (typeof text !== "string" || !text.trim()) return null;
  if (!CATEGORIES.has(category) || !DIFFICULTIES.has(difficulty)) return null;
  return { index, text: text.slice(0, MAX_TEXT), category, difficulty };
};

export const setCurrentQuestion = (map, roomId, question) => map.set(roomId, question);
export const getCurrentQuestion = (map, roomId) => map.get(roomId);
export const clearCurrentQuestion = (map, roomId) => map.delete(roomId);
```

- [ ] Step 4 — tests PASS; `npm test` green (98 + 10).
- [ ] Step 5 — commit `feat(room): sanitize and store the interview's current question`.

### Task 2: Socket wiring in `server.js`

**Files:** Modify `backend/src/server.js`.

- [ ] Import the four helpers. Add `const roomQuestions = new Map();` beside `roomState`.
- [ ] In `join-room`, right after `socket.data.roomId = roomId;`:
  ```js
  // Replay the current question first: the code-snapshot branch below may return early.
  const current = getCurrentQuestion(roomQuestions, roomId);
  if (current) socket.emit("question-update", current);
  ```
- [ ] New handler:
  ```js
  socket.on("question-change", ({ roomId, question } = {}) => {
    if (!socket.rooms.has(roomId)) return;
    const clean = sanitizeAskedQuestion(question);
    if (!clean) return;
    setCurrentQuestion(roomQuestions, roomId, clean);
    io.to(roomId).emit("question-update", clean);
  });
  ```
- [ ] In `disconnect`, inside the `if (!room || room.size === 0)` block, add `clearCurrentQuestion(roomQuestions, roomId);`.
- [ ] `npm test` green, then commit `feat(room): sync the current question over Socket.io`.
  (Wiring is verified live in Task 5; `server.js` has no unit-test harness.)

### Task 3: Shared types + `QuestionsPanel` component (frontend refactor)

**Files:** Create `frontend/src/lib/questions.ts` and `frontend/src/components/QuestionsPanel.tsx`. Modify `frontend/src/pages/InterviewRoom.tsx`.

- [ ] `questions.ts` exports `QuestionSource`, `Question` (moved verbatim from `InterviewRoom.tsx`), and `AskedQuestion = { index: number; text: string; category: Question['category']; difficulty: Question['difficulty'] }`.
- [ ] Move the `API` const and the whole `QuestionsPanel` component verbatim into `QuestionsPanel.tsx` (default export), importing its icons from lucide and its types from `../lib/questions`.
- [ ] In `InterviewRoom.tsx`:
  - delete the moved code;
  - import `QuestionsPanel` and the types;
  - drop now-unused icon imports (`Sparkles`, `ExternalLink`) if nothing else uses them.
- [ ] `npm run build` exit 0; lint at baseline. The behaviour is identical. Commit `refactor(ui): extract QuestionsPanel into a shared component`.

### Task 4: Ask + current-question banner in the editor; generate on the confirmation screen

**Files:** Modify `frontend/src/components/CollaborativeEditor.tsx`, `frontend/src/pages/InterviewRoom.tsx`, `frontend/src/pages/NewInterview.tsx`.

- [ ] **`CollaborativeEditor`:**
  - New optional prop `askableQuestions?: Question[]`; state `current: AskedQuestion | null`.
  - In the socket effect, add `socketRef.current.on('question-update', (q: AskedQuestion) => setCurrent(q));`.
  - `ask(i)` emits `question-change` with `{ roomId, question: { index: i, text, category, difficulty } }`. It does not set state locally; the server echo updates everyone, including the sender.
  - Layout: the existing toolbar stays. Below it, a row holds:
    - if `askableQuestions` is set, a left column `w-60` listing each question: number, category · difficulty, `line-clamp-2` text, LeetCode badge when `source` is set, and an **Ask** button. Its empty state reads "No approved questions yet — generate them on the Questions tab."
    - the editor column, containing a banner above Monaco:
      - when `current` is set: "Current question" label, text, category · difficulty, and — only when `askableQuestions?.[current.index]?.source` — the LeetCode badge;
      - when `current` is null and `askableQuestions` is set: hint "Click Ask on a question to show it to the candidate.";
      - when `current` is null and `askableQuestions` is unset: no banner.
    - the existing editor/console split, unchanged, below the banner.
- [ ] **`InterviewRoom`:** pass `askableQuestions={isInterviewer ? interviewData?.questions ?? [] : undefined}` to `CollaborativeEditor`.
- [ ] **`NewInterview` confirmation screen** (the `if (created)` branch):
  - Add state `genQuestions`, `genJobId` and `savedGenQuestions`. Reset all three in "Schedule Another".
  - Render, inside a dark card titled "Generate questions (optional)":
    ```tsx
    <QuestionsPanel
      interviewId={created._id}
      clerkId={user?.id ?? 'demo'}
      questions={genQuestions}
      setQuestions={setGenQuestions}
      jobId={genJobId}
      setJobId={setGenJobId}
      savedQuestions={savedGenQuestions}
      onSaved={setSavedGenQuestions}
    />
    ```
    with a one-line note: "Approved questions show up in the interview room's Code tab."
- [ ] `npm run build` exit 0; lint at baseline. Commit `feat(ui): generate questions at creation and ask them from the code editor`.

### Task 5: Live QA

- [ ] **Socket check:** a scratch script using socket.io-client from `frontend/node_modules`.
  1. Clients A and B join room `qa-room`. A emits a valid `question-change` with an extra `source`.
     Expect both A and B to receive `question-update` without `source`.
  2. Client C joins afterwards. Expect C to receive it immediately on join.
  3. A emits a malformed payload (`category: "trivia"`). Expect nobody to receive anything.
  4. Client D, not in the room, emits a valid change for `qa-room`. Expect nobody to receive it.
- [ ] **Browser check (headless Playwright, guest mode):**
  1. Continue as Guest → New Interview: pick a role, fill the form, then Schedule.
  2. Generate questions → Approve & save.
  3. Open the room → Code tab: the list shows the questions with badges.
  4. Ask question 2: the banner shows it.
  5. Open a second page on the same room: its banner shows the same question.
  6. Screenshot and inspect each step.
- [ ] Report results.
