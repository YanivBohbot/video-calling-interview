import "dotenv/config";
import { createServer } from "http";
import { Server } from "socket.io";
import { loadConfig } from "./config/env.js";
import { connectDB, prisma } from "./lib/db.js";
import { createContainer } from "./container.js";
import { createApp } from "./app.js";
import {
  applyCodeChange,
  applyLanguageChange,
  flushAllDirty,
  flushRoomOnExit,
} from "./lib/roomState.js";
import {
  sanitizeAskedQuestion,
  setCurrentQuestion,
  getCurrentQuestion,
  clearCurrentQuestion,
} from "./lib/roomQuestions.js";
import { getLeetCodeTools } from "./lib/agents/leetcodeMcpClient.js";
import { ensureCheckpointerTables } from "./lib/agents/questionGenerator/graph.js";

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  // Only variable names are in this message — never their values.
  console.error(err.message);
  process.exit(1);
}

const container = createContainer({ config, prisma });
const app = createApp(container);
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: config.clientUrl,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const roomState = new Map();
// Kept apart from roomState: creating a roomState entry would make rejoiners receive
// empty code instead of the persisted snapshot.
const roomQuestions = new Map();
const FLUSH_INTERVAL_MS = 10_000;

let isFlushing = false;

setInterval(() => {
  if (isFlushing) return; // a previous pass is still in flight — skip this tick
  isFlushing = true;
  flushAllDirty(roomState, prisma.interview)
    .catch((err) => {
      console.error("roomState: periodic flush error:", err.message);
    })
    .finally(() => {
      isFlushing = false;
    });
}, FLUSH_INTERVAL_MS);

// Socket.io logic
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join-room", async (roomId) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    console.log(`User ${socket.id} joined room: ${roomId}`);

    // Replay the current question first: the code-snapshot branch below may return early.
    const current = getCurrentQuestion(roomQuestions, roomId);
    if (current) socket.emit("question-update", current);

    // Send the room's current state back to *this* socket only, so a (re)joining
    // client is seeded from the server rather than from a stale page-load snapshot.
    const entry = roomState.get(roomId);
    if (entry) {
      // Live in-memory state wins — it is newer than anything in Postgres.
      socket.emit("code-update", entry.code);
      socket.emit("language-update", entry.language);
      return;
    }

    // No live room (fresh room, or a previous participant's flush-on-exit already
    // wrote and cleared it) — fall back to the persisted snapshot.
    try {
      const interview = await prisma.interview.findUnique({
        where: { id: roomId },
        select: { codeSnapshot: true, codeLanguage: true },
      });
      if (!interview) return; // unknown room (e.g. the demo 'default' id) — leave the client default
      if (interview.codeSnapshot != null) socket.emit("code-update", interview.codeSnapshot);
      if (interview.codeLanguage != null) socket.emit("language-update", interview.codeLanguage);
    } catch (err) {
      console.error(`roomState: failed to load snapshot for room ${roomId}:`, err.message);
    }
  });

  socket.on("code-change", ({ roomId, code }) => {
    if (!socket.rooms.has(roomId)) return;
    socket.to(roomId).emit("code-update", code);
    applyCodeChange(roomState, roomId, code);
  });

  socket.on("language-change", ({ roomId, language }) => {
    if (!socket.rooms.has(roomId)) return;
    socket.to(roomId).emit("language-update", language);
    applyLanguageChange(roomState, roomId, language);
  });

  socket.on("question-change", ({ roomId, question } = {}) => {
    if (!socket.rooms.has(roomId)) return;
    const clean = sanitizeAskedQuestion(question);
    if (!clean) return;
    setCurrentQuestion(roomQuestions, roomId, clean);
    io.to(roomId).emit("question-update", clean);
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
        clearCurrentQuestion(roomQuestions, roomId);
        flushRoomOnExit(roomState, prisma.interview, roomId).catch((err) => {
          console.error(`roomState: flush-on-exit error for room ${roomId}:`, err.message);
        });
      }
    }
  });
});

const startServer = async () => {
  await connectDB();
  httpServer.listen(config.port, () => {
    console.log(`Server running on port ${config.port} (client: ${config.clientUrl})`);
  });
  // Warm the LeetCode MCP connection at boot (fire-and-forget) so the npx download and
  // stdio handshake happen now, not on the first user-facing generate request.
  // getLeetCodeTools never rejects; it resolves to [] on failure and retries on next call.
  getLeetCodeTools().catch(() => {});
  // Idempotent: creates the LangGraph checkpointer's Postgres tables if missing. Best-effort —
  // a slow DB at boot must not crash the server; generation will then fail per-request instead.
  ensureCheckpointerTables().catch((err) => console.error("Checkpointer setup failed:", err.message));
};

startServer().catch((err) => {
  console.error("Start server error:", err.message);
  process.exit(1);
});
