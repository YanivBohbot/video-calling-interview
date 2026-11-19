import { getCurrentQuestion } from "../roomQuestions.js";

export const createJoinRoomHandler = ({ roomState, roomQuestions, findCodeSnapshot }) => (socket) => async (roomId) => {
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
    const interview = await findCodeSnapshot(roomId);
    if (!interview) return; // unknown room (e.g. the demo 'default' id) — leave the client default
    if (interview.codeSnapshot != null) socket.emit("code-update", interview.codeSnapshot);
    if (interview.codeLanguage != null) socket.emit("language-update", interview.codeLanguage);
  } catch (err) {
    console.error(`roomState: failed to load snapshot for room ${roomId}:`, err.message);
  }
};
