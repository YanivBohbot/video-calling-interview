# Interview Code & Questions Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the interview's live code (content + language) to Postgres via a debounced server-side autosave, and add an empty `questions` column to `Interview` as a schema seam for a future AI feature.

**Architecture:** `server.js`'s existing Socket.io relay (currently pure broadcast, no persistence) gains an in-memory per-room state map. A pure, unit-testable module (`backend/src/lib/roomState.js`) tracks each room's latest code/language and a `dirty` flag; `server.js` calls into it on every `code-change`/`language-change` event, flushes dirty rooms to Postgres via Prisma every 10s, and flushes-and-clears a room immediately when its last socket disconnects. The frontend fetches the interview record once on mount and seeds `CollaborativeEditor`'s initial state from `codeSnapshot`/`codeLanguage` instead of a hardcoded placeholder.

**Tech Stack:** Express 5 (ESM) + Socket.io 4 + Prisma 6/PostgreSQL backend, React 19 + TypeScript frontend, Vitest for backend unit tests (new to this repo — no test runner exists yet).

**Spec:** `docs/superpowers/specs/2026-07-29-code-questions-foundation-design.md`

## Global Constraints

- Room id == interview id (confirmed: `CollaborativeEditor roomId={id || 'default'}` in `InterviewRoom.tsx:234`, where `id` is the route param).
- Backend + Socket.io run in a single Node process on one port (`ENV.PORT`, currently `3001` per `backend/.env`) — no cross-process state sharing needed.
- No new REST endpoints — `toInterviewDoc` in `backend/src/controllers/controller.js` already spreads all non-relation fields of the Prisma record (`const { id, interviewer, interviewerId, ...rest } = iv;`), so new Prisma columns appear in API responses automatically with zero controller changes. Verified by reading `controller.js:17-32`.
- Do not touch the existing broadcast behavior (`socket.to(roomId).emit(...)`) — only add persistence alongside it.
- Paste-burst detection and any AI/agent work are explicitly out of scope for this plan.

---

### Task 1: Vitest test harness for backend

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.js`

**Interfaces:**
- Produces: `npm test` (and `npm run test:watch`) runnable from `backend/`, picking up `src/**/*.test.js`.

- [ ] **Step 1: Install Vitest as a dev dependency**

Run from `backend/`:
```bash
npm install -D vitest
```

- [ ] **Step 2: Add test scripts to `backend/package.json`**

In the `"scripts"` block, add two entries so it reads:
```json
"scripts": {
  "dev": "nodemon src/server.js",
  "seed": "node src/lib/seed.js",
  "db:migrate": "prisma migrate dev",
  "db:generate": "prisma generate",
  "test": "vitest run",
  "test:watch": "vitest"
},
```

- [ ] **Step 3: Create `backend/vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.js"],
  },
});
```

- [ ] **Step 4: Verify Vitest runs and finds nothing yet**

Run from `backend/`: `npm test`
Expected: exits clean with `No test files found` (or equivalent), exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.js
git commit -m "chore: add vitest test harness to backend"
```

---

### Task 2: Add `codeSnapshot`, `codeLanguage`, `questions` to `Interview`

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `Interview.codeSnapshot: string | null`, `Interview.codeLanguage: string | null` (default `"javascript"`), `Interview.questions: Json | null` on the Prisma client, available to every later task.

- [ ] **Step 1: Add the three fields to the `Interview` model**

In `backend/prisma/schema.prisma`, the `Interview` model currently ends:
```prisma
model Interview {
  id             String   @id @default(cuid())
  interviewerId  String
  interviewer    User     @relation(fields: [interviewerId], references: [id])
  candidateName  String
  candidateEmail String
  role           String
  scheduledAt    DateTime
  status         String   @default("scheduled")
  duration       Int      @default(60)
  interviewType  String   @default("technical")
  notes          String   @default("")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("interviews")
}
```

Change it to:
```prisma
model Interview {
  id             String   @id @default(cuid())
  interviewerId  String
  interviewer    User     @relation(fields: [interviewerId], references: [id])
  candidateName  String
  candidateEmail String
  role           String
  scheduledAt    DateTime
  status         String   @default("scheduled")
  duration       Int      @default(60)
  interviewType  String   @default("technical")
  notes          String   @default("")
  codeSnapshot   String?
  codeLanguage   String?  @default("javascript")
  questions      Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("interviews")
}
```

- [ ] **Step 2: Create and apply the migration**

Run from `backend/`:
```bash
npx prisma migrate dev --name add_code_and_questions
```
Expected: a new migration directory under `backend/prisma/migrations/`, Prisma Client regenerated without errors.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(db): add codeSnapshot, codeLanguage, questions to Interview"
```

---

### Task 3: `roomState.js` — track per-room code/language (TDD)

**Files:**
- Create: `backend/src/lib/roomState.test.js`
- Create: `backend/src/lib/roomState.js`

**Interfaces:**
- Consumes: nothing (pure module, no external deps).
- Produces: `applyCodeChange(state: Map, roomId: string, code: string): void`, `applyLanguageChange(state: Map, roomId: string, language: string): void` — both used by Task 5 (`server.js` wiring) and Task 4 (flush functions in this same file).

- [ ] **Step 1: Write the failing tests**

`backend/src/lib/roomState.test.js`:
```js
import { describe, it, expect } from "vitest";
import { applyCodeChange, applyLanguageChange } from "./roomState.js";

describe("applyCodeChange", () => {
  it("creates a new entry with dirty=true on first call", () => {
    const state = new Map();
    applyCodeChange(state, "room-1", "console.log(1)");
    expect(state.get("room-1")).toEqual({
      code: "console.log(1)",
      language: "javascript",
      dirty: true,
    });
  });

  it("updates an existing entry's code without touching its language", () => {
    const state = new Map([["room-1", { code: "old", language: "python", dirty: false }]]);
    applyCodeChange(state, "room-1", "new code");
    expect(state.get("room-1")).toEqual({ code: "new code", language: "python", dirty: true });
  });
});

describe("applyLanguageChange", () => {
  it("creates a new entry with dirty=true on first call", () => {
    const state = new Map();
    applyLanguageChange(state, "room-1", "python");
    expect(state.get("room-1")).toEqual({ code: "", language: "python", dirty: true });
  });

  it("updates an existing entry's language without touching its code", () => {
    const state = new Map([["room-1", { code: "keep me", language: "javascript", dirty: false }]]);
    applyLanguageChange(state, "room-1", "cpp");
    expect(state.get("room-1")).toEqual({ code: "keep me", language: "cpp", dirty: true });
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run from `backend/`: `npm test -- roomState`
Expected: FAIL — `Cannot find module './roomState.js'`.

- [ ] **Step 3: Implement the entry-tracking half of `backend/src/lib/roomState.js`**

```js
const DEFAULT_LANGUAGE = "javascript";

const getOrCreateEntry = (state, roomId) => {
  let entry = state.get(roomId);
  if (!entry) {
    entry = { code: "", language: DEFAULT_LANGUAGE, dirty: false };
    state.set(roomId, entry);
  }
  return entry;
};

export const applyCodeChange = (state, roomId, code) => {
  const entry = getOrCreateEntry(state, roomId);
  entry.code = code;
  entry.dirty = true;
};

export const applyLanguageChange = (state, roomId, language) => {
  const entry = getOrCreateEntry(state, roomId);
  entry.language = language;
  entry.dirty = true;
};
```

- [ ] **Step 4: Run and verify it passes**

Run from `backend/`: `npm test -- roomState`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/roomState.js backend/src/lib/roomState.test.js
git commit -m "feat(rooms): track per-room code/language with dirty flag"
```

---

### Task 4: `flushAllDirty` / `flushRoomOnExit` — persist to Postgres (TDD)

**Files:**
- Modify: `backend/src/lib/roomState.test.js`
- Modify: `backend/src/lib/roomState.js`

**Interfaces:**
- Consumes: `getOrCreateEntry` (internal, from Task 3).
- Produces: `flushAllDirty(state: Map, prismaInterview: { update: Function }): Promise<void>` and `flushRoomOnExit(state: Map, prismaInterview: { update: Function }, roomId: string): Promise<void>` — both used by Task 5 (`server.js` wiring: the former on a `setInterval`, the latter on socket `disconnect`).

- [ ] **Step 1: Append the failing tests**

Append to `backend/src/lib/roomState.test.js` (new imports at the top, new `describe` blocks at the bottom):
```js
import { describe, it, expect, vi } from "vitest";
import { applyCodeChange, applyLanguageChange, flushAllDirty, flushRoomOnExit } from "./roomState.js";

// ...(keep the existing describe blocks above, add these below)

describe("flushAllDirty", () => {
  it("writes dirty rooms to the DB and clears their dirty flag", async () => {
    const state = new Map([
      ["room-1", { code: "a", language: "javascript", dirty: true }],
      ["room-2", { code: "b", language: "python", dirty: false }],
    ]);
    const update = vi.fn().mockResolvedValue({});
    await flushAllDirty(state, { update });

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: "room-1" },
      data: { codeSnapshot: "a", codeLanguage: "javascript" },
    });
    expect(state.get("room-1").dirty).toBe(false);
    expect(state.get("room-2").dirty).toBe(false); // untouched, was already clean
  });

  it("leaves a room dirty and does not throw when the update fails with P2025", async () => {
    const state = new Map([["room-1", { code: "a", language: "javascript", dirty: true }]]);
    const err = Object.assign(new Error("not found"), { code: "P2025" });
    const update = vi.fn().mockRejectedValue(err);

    await expect(flushAllDirty(state, { update })).resolves.toBeUndefined();
    expect(state.get("room-1").dirty).toBe(true);
  });

  it("does not throw on an unexpected error either, and leaves the room dirty", async () => {
    const state = new Map([["room-1", { code: "a", language: "javascript", dirty: true }]]);
    const update = vi.fn().mockRejectedValue(new Error("connection reset"));

    await expect(flushAllDirty(state, { update })).resolves.toBeUndefined();
    expect(state.get("room-1").dirty).toBe(true);
  });
});

describe("flushRoomOnExit", () => {
  it("flushes a dirty room then removes it from state", async () => {
    const state = new Map([["room-1", { code: "a", language: "javascript", dirty: true }]]);
    const update = vi.fn().mockResolvedValue({});

    await flushRoomOnExit(state, { update }, "room-1");

    expect(update).toHaveBeenCalledWith({
      where: { id: "room-1" },
      data: { codeSnapshot: "a", codeLanguage: "javascript" },
    });
    expect(state.has("room-1")).toBe(false);
  });

  it("removes a clean room without calling update", async () => {
    const state = new Map([["room-1", { code: "a", language: "javascript", dirty: false }]]);
    const update = vi.fn();

    await flushRoomOnExit(state, { update }, "room-1");

    expect(update).not.toHaveBeenCalled();
    expect(state.has("room-1")).toBe(false);
  });

  it("is a no-op when the room does not exist in state", async () => {
    const state = new Map();
    const update = vi.fn();

    await expect(flushRoomOnExit(state, { update }, "missing-room")).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and verify the new tests fail**

Run from `backend/`: `npm test -- roomState`
Expected: FAIL — `flushAllDirty`/`flushRoomOnExit` are not exported yet.

- [ ] **Step 3: Implement the flush half of `backend/src/lib/roomState.js`**

Append to `backend/src/lib/roomState.js` (keep everything from Task 3 above it):
```js
const saveRoom = async (state, prismaInterview, roomId) => {
  const entry = state.get(roomId);
  if (!entry || !entry.dirty) return;

  try {
    await prismaInterview.update({
      where: { id: roomId },
      data: { codeSnapshot: entry.code, codeLanguage: entry.language },
    });
    entry.dirty = false;
  } catch (err) {
    if (err.code !== "P2025") {
      console.error(`roomState: failed to flush room ${roomId}:`, err.message);
    }
    // Leave dirty=true either way — a missing interview (P2025) or a transient
    // DB error both just get retried on the next flush pass, harmlessly.
  }
};

export const flushAllDirty = async (state, prismaInterview) => {
  for (const roomId of state.keys()) {
    await saveRoom(state, prismaInterview, roomId);
  }
};

export const flushRoomOnExit = async (state, prismaInterview, roomId) => {
  await saveRoom(state, prismaInterview, roomId);
  state.delete(roomId);
};
```

- [ ] **Step 4: Run and verify all tests pass**

Run from `backend/`: `npm test -- roomState`
Expected: all 10 tests (4 from Task 3 + 6 from this task) pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/roomState.js backend/src/lib/roomState.test.js
git commit -m "feat(rooms): flush dirty room code to Postgres"
```

---

### Task 5: Wire `roomState` into `server.js`

**Files:**
- Modify: `backend/src/server.js`

**Interfaces:**
- Consumes: `applyCodeChange`, `applyLanguageChange`, `flushAllDirty`, `flushRoomOnExit` (from Task 3/4), `prisma` (from `backend/src/lib/db.js`, already imported elsewhere in the file as `connectDB` — need to also import the `prisma` named export).

- [ ] **Step 1: Add imports**

In `backend/src/server.js`, the top of the file currently reads:
```js
import express from "express";
import dotenv from "dotenv";
import { ENV } from "./lib/env.js";
import { connectDB } from "./lib/db.js";
import cors from "cors";
```

Change the `db.js` import line and add a new import right after it:
```js
import express from "express";
import dotenv from "dotenv";
import { ENV } from "./lib/env.js";
import { connectDB, prisma } from "./lib/db.js";
import cors from "cors";
import {
  applyCodeChange,
  applyLanguageChange,
  flushAllDirty,
  flushRoomOnExit,
} from "./lib/roomState.js";
```

- [ ] **Step 2: Add the room state map and flush interval**

Immediately after the existing block:
```js
const io = new Server(httpServer, {
  cors: {
    origin: ENV.CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
```
add:
```js

const roomState = new Map();
const FLUSH_INTERVAL_MS = 10_000;

setInterval(() => {
  flushAllDirty(roomState, prisma.interview).catch((err) => {
    console.error("roomState: periodic flush error:", err.message);
  });
}, FLUSH_INTERVAL_MS);
```

- [ ] **Step 3: Track each socket's room and update state on code/language events**

The current Socket.io block is:
```js
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);
  });

  socket.on("code-change", ({ roomId, code }) => {
    socket.to(roomId).emit("code-update", code);
  });

  socket.on("language-change", ({ roomId, language }) => {
    socket.to(roomId).emit("language-update", language);
  });

  socket.on("code-execution", ({ roomId, result }) => {
    socket.to(roomId).emit("execution-result", result);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});
```

Replace it with:
```js
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    console.log(`User ${socket.id} joined room: ${roomId}`);
  });

  socket.on("code-change", ({ roomId, code }) => {
    socket.to(roomId).emit("code-update", code);
    applyCodeChange(roomState, roomId, code);
  });

  socket.on("language-change", ({ roomId, language }) => {
    socket.to(roomId).emit("language-update", language);
    applyLanguageChange(roomState, roomId, language);
  });

  socket.on("code-execution", ({ roomId, result }) => {
    socket.to(roomId).emit("execution-result", result);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    const roomId = socket.data.roomId;
    if (roomId) {
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size === 0) {
        flushRoomOnExit(roomState, prisma.interview, roomId).catch((err) => {
          console.error(`roomState: flush-on-exit error for room ${roomId}:`, err.message);
        });
      }
    }
  });
});
```

- [ ] **Step 4: Manual sanity check — server boots**

Run from `backend/`: `npm run dev`
Expected: server boots without errors, logs `Server running on port 3001` (or whatever `PORT` is set to). Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(rooms): autosave interview code via debounced periodic flush"
```

---

### Task 6: Manual verification — API returns the new fields

No code changes in this task — it confirms the "Global Constraints" claim that `toInterviewDoc`'s spread already exposes the new columns, so there is nothing to build here, only to check.

- [ ] **Step 1: Start backend and set a code snapshot directly via Prisma Studio or SQL**

Run from `backend/`: `npm run dev` (in one shell) and `npx prisma studio` (in another). In Prisma Studio, open an existing `Interview` row and manually set `codeSnapshot` to `"test-value"` and `codeLanguage` to `"python"`, save.

- [ ] **Step 2: Confirm the field appears in the API response**

Run (replace `<id>` with that row's id):
```bash
curl http://localhost:3001/api/interviews/<id>
```
Expected: JSON response includes `"codeSnapshot":"test-value"`, `"codeLanguage":"python"`, and `"questions":null`, with no changes needed to `controller.js`.

- [ ] **Step 3: Revert the manual test value**

In Prisma Studio, clear `codeSnapshot`/`codeLanguage` back to empty/`javascript` on that row (so it doesn't pollute real data). No commit needed — this task touched no files.

---

### Task 7: `CollaborativeEditor` accepts initial code/language

**Files:**
- Modify: `frontend/src/components/CollaborativeEditor.tsx`

**Interfaces:**
- Produces: `CollaborativeEditor` now accepts optional `initialCode?: string` and `initialLanguage?: string` props, consumed by Task 8 (`InterviewRoom.tsx`).

- [ ] **Step 1: Extend the props interface and use the new props as initial state**

Current top of `frontend/src/components/CollaborativeEditor.tsx`:
```tsx
interface CodeEditorProps {
  roomId: string;
}

const CollaborativeEditor: React.FC<CodeEditorProps> = ({ roomId }) => {
  const [code, setCode] = useState<string>('// Welcome to the Interview Code Editor\n\nfunction solution() {\n  console.log("Hello, TalentIQ!");\n}\n\nsolution();');
  const [language, setLanguage] = useState<string>('javascript');
```

Change to:
```tsx
interface CodeEditorProps {
  roomId: string;
  initialCode?: string;
  initialLanguage?: string;
}

const CollaborativeEditor: React.FC<CodeEditorProps> = ({ roomId, initialCode, initialLanguage }) => {
  const [code, setCode] = useState<string>(
    initialCode ?? '// Welcome to the Interview Code Editor\n\nfunction solution() {\n  console.log("Hello, TalentIQ!");\n}\n\nsolution();',
  );
  const [language, setLanguage] = useState<string>(initialLanguage ?? 'javascript');
```

No other lines in the file change — the existing socket `code-update`/`language-update` listeners already override this initial state when a live peer is present, exactly as today.

- [ ] **Step 2: Type-check**

Run from `frontend/`: `npx tsc -b --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CollaborativeEditor.tsx
git commit -m "feat(editor): accept initial code/language from parent"
```

---

### Task 8: `InterviewRoom` fetches the interview and passes initial code/language

**Files:**
- Modify: `frontend/src/pages/InterviewRoom.tsx`

**Interfaces:**
- Consumes: `CollaborativeEditor`'s `initialCode`/`initialLanguage` props (Task 7). `GET /api/interviews/:id` (existing endpoint, now returning `codeSnapshot`/`codeLanguage` per Task 6).

- [ ] **Step 1: Add interview-fetch state**

`frontend/src/pages/InterviewRoom.tsx:92-99` currently reads:
```tsx
export const InterviewRoom: React.FC = () => {
  const { id } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();
  const [client, setClient] = React.useState<StreamVideoClient | null>(null);
  const [call, setCall] = React.useState<any>(null);
  const [activeTab, setActiveTab] = React.useState<'code' | 'design'>('code');
  const [showReport, setShowReport] = React.useState(false);
```

Add one more state variable and a type for it, right after `showReport`:
```tsx
  const [showReport, setShowReport] = React.useState(false);
  const [interviewData, setInterviewData] = React.useState<{
    codeSnapshot?: string | null;
    codeLanguage?: string | null;
  } | null>(null);
```

- [ ] **Step 2: Fetch the interview record once on mount**

The existing effect at `frontend/src/pages/InterviewRoom.tsx:101-142` starts with:
```tsx
  React.useEffect(() => {
    if (!id) return;

    const currentUser = user || {
```

Add a second, independent effect right after that whole effect's closing (after the line `}, [user, id]);` at line 142), so it does not interfere with the Stream video setup:
```tsx
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;

    fetch(`http://localhost:3001/api/interviews/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setInterviewData(data);
      })
      .catch((err) => console.error('Failed to fetch interview data:', err));

    return () => {
      cancelled = true;
    };
  }, [id]);
```

- [ ] **Step 3: Pass the fetched values into `CollaborativeEditor`**

`frontend/src/pages/InterviewRoom.tsx:233-234` currently reads:
```tsx
                  {activeTab === 'code' ? (
                    <CollaborativeEditor roomId={id || 'default'} />
                  ) : (
```

Change to:
```tsx
                  {activeTab === 'code' ? (
                    <CollaborativeEditor
                      roomId={id || 'default'}
                      initialCode={interviewData?.codeSnapshot ?? undefined}
                      initialLanguage={interviewData?.codeLanguage ?? undefined}
                    />
                  ) : (
```

- [ ] **Step 4: Type-check**

Run from `frontend/`: `npx tsc -b --noEmit`
Expected: no new type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/InterviewRoom.tsx
git commit -m "feat(room): hydrate code editor from saved interview snapshot"
```

---

### Task 9: End-to-end manual verification

- [ ] **Step 1: Verify backend unit tests pass clean**

Run from `backend/`: `npm test`
Expected: all `roomState` suites green (10 tests from Tasks 3–4).

- [ ] **Step 2: Verify live sync still works (regression check)**

Start both servers (`npm run dev` in `backend/` and `frontend/`). Open the same interview room URL in two browser tabs. Type in tab A, confirm tab B updates within ~1s (existing behavior, must be unchanged).

- [ ] **Step 3: Verify autosave + reload**

With both tabs still open from Step 2, type a distinctive string (e.g. `// AUTOSAVE-TEST-123`), wait at least 11 seconds (past one flush interval), then refresh both tabs.
Expected: both tabs reload showing the code containing `// AUTOSAVE-TEST-123` (loaded from `codeSnapshot`, not the hardcoded placeholder).

- [ ] **Step 4: Verify a fresh interview still shows the placeholder**

Open a brand-new interview (one that has never had code typed into it) in a browser tab.
Expected: editor shows the original "Welcome to the Interview Code Editor" placeholder, not an error, not `undefined`.

- [ ] **Step 5: Verify room cleanup on disconnect**

After Step 3, close both browser tabs (or navigate away). Check the backend's console output.
Expected: no unhandled promise rejection or crash logged; the `disconnect` handler's flush-on-exit path runs silently.

- [ ] **Step 6: Final commit if any tweaks were needed**

```bash
git status
# if clean, nothing to do.
# if there were fixes, commit them with a clear message.
```

---

## Self-Review Notes

- **Spec coverage:** §3 data model → Task 2. §4.1/4.2/4.3 room state + flush logic → Tasks 3–5. §4.4 API surface → Task 6 (verified as already-working, no code needed — matches the spec's rationale that `toInterviewDoc`'s spread pattern already covers it). §5 frontend → Tasks 7–8. §6 error handling → Task 4's three flush tests (success, P2025, unexpected error) plus Task 5's `.catch` wrapping on both the interval and the disconnect path. §7 testing → Tasks 3–4 (automated) and Task 9 (manual, mirroring the spec's documented manual-verification plan). §8/§9 out-of-scope/future notes → no tasks, intentionally.
- **Type/name consistency:** `applyCodeChange`, `applyLanguageChange`, `flushAllDirty`, `flushRoomOnExit` are named identically everywhere they're defined (Tasks 3–4) and consumed (Task 5). The `{ code, language, dirty }` entry shape is consistent across all `roomState.js` functions and their tests. `codeSnapshot`/`codeLanguage` field names match across the Prisma schema (Task 2), the flush `data` payload (Task 4), and the frontend prop names read off the fetched interview (Task 8) — note the frontend prop names (`initialCode`/`initialLanguage`, Task 7) are intentionally different from the DB field names since they serve a different purpose (seeding local state vs. persisted columns).
- **No placeholders found.**
