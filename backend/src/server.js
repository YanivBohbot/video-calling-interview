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
import {
  sanitizeAskedQuestion,
  setCurrentQuestion,
  getCurrentQuestion,
  clearCurrentQuestion,
} from "./lib/roomQuestions.js";
import interviewRoutes from "./routes/interview.routes.js";
import streamRoutes from "./routes/stream.routes.js";
import userRoutes from "./routes/user.routes.js";
import sessionRoutes from "./routes/session.routes.js";
import { getLeetCodeTools } from "./lib/agents/leetcodeMcpClient.js";
import { ensureCheckpointerTables } from "./lib/agents/questionGenerator/graph.js";

import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ENV.CLIENT_URL,
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

// middelware
app.use(express.json());
app.use(cors({ origin: ENV.CLIENT_URL, credentials: true }));

// Routes
app.use("/api/interviews", interviewRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/users", userRoutes);
app.use("/api/sessions", sessionRoutes);

console.log(process.env.PORT);

app.get("/health", (req, res) => {
  res.status(200).json({ msg: "success from backedn" });
});

app.get("/books", (req, res) => {
  res.status(200).json({ msg: "success from backedn" });
});

console.log("Starting server with ENV:", ENV);

const startServer = async () => {
  try {
    console.log("Connecting to DB...");
    await connectDB();
    console.log("DB connected, starting HTTP server...");
    httpServer.listen(ENV.PORT, () => {
      console.log(`Server running on port ${ENV.PORT}`);
    });
    // Warm the LeetCode MCP connection at boot (fire-and-forget) so the npx download and
    // stdio handshake happen now, not on the first user-facing generate request.
    // getLeetCodeTools never rejects; it resolves to [] on failure and retries on next call.
    getLeetCodeTools().catch(() => {});
    // Idempotent: creates the LangGraph checkpointer's Postgres tables if missing. Best-effort —
    // a slow DB at boot must not crash the server; generation will then fail per-request instead.
    ensureCheckpointerTables().catch((err) => console.error("Checkpointer setup failed:", err.message));
  } catch (err) {
    console.log("Start server error:", err);
  }
};

startServer();

export default app;
