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
//   authenticator     — Socket.io middleware setting socket.data.principal (see authenticateSocket.js)
//   canAccessRoom     — (principal, roomId) → Promise<boolean>
//   roomQuestions     — Map roomId → the question on screen; shared with the AI interviewer
export const attachRealtime = ({
  httpServer,
  clientUrl,
  interviewStore,
  findCodeSnapshot,
  authenticator,
  canAccessRoom,
  roomQuestions = new Map(),
  roomOwners = new Map(),
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
}) => {
  const io = new Server(httpServer, {
    cors: { origin: clientUrl, methods: ["GET", "POST"], credentials: true },
  });

  const roomState = new Map();
  // roomQuestions is kept apart from roomState: creating a roomState entry would make
  // rejoiners receive empty code instead of the persisted snapshot.

  // Every connection must present a credential.
  io.use(authenticator);

  // Every question asked so far per room (the candidate's "Questions" menu).
  const askedQuestions = new Map();
  const ctx = { io, roomState, roomQuestions, roomOwners, askedQuestions, interviewStore, findCodeSnapshot, canAccessRoom };
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
