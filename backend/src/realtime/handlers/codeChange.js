import { applyCodeChange } from "../roomState.js";

export const createCodeChangeHandler = ({ roomState }) => (socket) => ({ roomId, code } = {}) => {
  if (!socket.rooms.has(roomId)) return;
  socket.to(roomId).emit("code-update", code);
  applyCodeChange(roomState, roomId, code);
};
