import { applyLanguageChange } from "../roomState.js";

export const createLanguageChangeHandler = ({ roomState }) => (socket) => ({ roomId, language } = {}) => {
  if (!socket.rooms.has(roomId)) return;
  socket.to(roomId).emit("language-update", language);
  applyLanguageChange(roomState, roomId, language);
};
