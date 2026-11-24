import { isOwnerKind } from "../../auth/principal.js";
import { addOwner, isOwnerPresent } from "../roomOwners.js";
import { getCurrentQuestion, getAskedQuestions } from "../roomQuestions.js";

export const createJoinRoomHandler = ({ io, roomState, roomQuestions, askedQuestions, roomOwners, findCodeSnapshot, canAccessRoom }) => (socket) => async (roomId) => {
  // Owners may enter their own interviews' rooms, a candidate only the invited one.
  // Socket.io ignores a listener's promise, so a rejection here would be unhandled and
  // could take the whole process down: refuse instead.
  let allowed = false;
  try {
    allowed = typeof roomId === "string" && (await canAccessRoom(socket.data.principal, roomId));
  } catch (err) {
    console.error(`join-room: access check failed for room ${roomId}:`, err.message);
  }
  if (!allowed) {
    socket.emit("error-message", "Forbidden");
    return;
  }
  socket.join(roomId);
  socket.data.roomId = roomId;
  console.log(`User ${socket.id} joined room: ${roomId}`);

  // Tell the room (and the newcomer) whether the interviewer is there. Only an owner's
  // first socket changes it; a socket counts once even if it joins again.
  if (isOwnerKind(socket.data.principal) && !socket.data.isOwner) {
    socket.data.isOwner = true;
    if (addOwner(roomOwners, roomId) === 1) io.to(roomId).emit("interviewer-presence", { present: true });
    else socket.emit("interviewer-presence", { present: true });
  } else {
    socket.emit("interviewer-presence", { present: isOwnerPresent(roomOwners, roomId) });
  }

  // Replay the current question first: the code-snapshot branch below may return early.
  const current = getCurrentQuestion(roomQuestions, roomId);
  if (current) socket.emit("question-update", current);
  const asked = getAskedQuestions(askedQuestions, roomId);
  if (asked.length > 0) socket.emit("questions-asked", asked);

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
