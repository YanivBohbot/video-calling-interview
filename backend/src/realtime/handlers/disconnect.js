import { flushRoomOnExit } from "../roomState.js";
import { clearCurrentQuestion, clearAskedQuestions } from "../roomQuestions.js";

// When the last participant leaves, persist the room's code and forget its live state.
export const createDisconnectHandler = ({ io, roomState, roomQuestions, askedQuestions, interviewStore }) => (socket) => () => {
  console.log("User disconnected:", socket.id);
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = io.sockets.adapter.rooms.get(roomId);
  if (room && room.size > 0) return;

  clearCurrentQuestion(roomQuestions, roomId);
  clearAskedQuestions(askedQuestions, roomId);
  flushRoomOnExit(roomState, interviewStore, roomId).catch((err) => {
    console.error(`roomState: flush-on-exit error for room ${roomId}:`, err.message);
  });
};
