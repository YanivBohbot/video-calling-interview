import { Server } from "socket.io";
import { flushAllDirty } from "./roomState.js";
import { createFlushScheduler } from "./flushScheduler.js";
import { createJoinRoomHandler } from "./handlers/joinRoom.js";
import { createCodeChangeHandler } from "./handlers/codeChange.js";
import { createLanguageChangeHandler } from "./handlers/languageChange.js";
import { createQuestionChangeHandler } from "./handlers/questionChange.js";
import { createCodeExecutionHandler } from "./handlers/codeExecution.js";
import { createDisconnectHandler } from "./handlers/disconnect.js";

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;

// Socket.io event → handler factory. Event names are the frontend contract.
const EVENTS = {
  "join-room": createJoinRoomHandler,
  "code-change": createCodeChangeHandler,
  "language-change": createLanguageChangeHandler,
  "question-change": createQuestionChangeHandler,
  "code-execution": createCodeExecutionHandler,
  disconnect: createDisconnectHandler,
};

// Attaches the collaborative-editor channel to the HTTP server.
//   interviewStore    — Prisma `interview` delegate (roomState persists through its `update`)
//   findCodeSnapshot  — (interviewId) → { codeSnapshot, codeLanguage } | null
export const attachRealtime = ({
  httpServer,
  clientUrl,
  interviewStore,
  findCodeSnapshot,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
}) => {
  const io = new Server(httpServer, {
    cors: { origin: clientUrl, methods: ["GET", "POST"], credentials: true },
  });

  const roomState = new Map();
  // Kept apart from roomState: creating a roomState entry would make rejoiners receive
  // empty code instead of the persisted snapshot.
  const roomQuestions = new Map();

  const ctx = { io, roomState, roomQuestions, interviewStore, findCodeSnapshot };
  const handlers = Object.entries(EVENTS).map(([event, factory]) => [event, factory(ctx)]);

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    for (const [event, forSocket] of handlers) socket.on(event, forSocket(socket));
  });

  const scheduler = createFlushScheduler({
    flush: () => flushAllDirty(roomState, interviewStore),
    intervalMs: flushIntervalMs,
  });
  scheduler.start();

  // Stops autosave, writes every dirty room one last time, then closes the sockets.
  const shutdown = async () => {
    scheduler.stop();
    await scheduler.flushNow();
    await new Promise((resolve) => io.close(() => resolve()));
  };

  return { io, shutdown };
};
