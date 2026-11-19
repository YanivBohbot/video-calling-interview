// Relays a "Run" result to the other participants. Only members of the room may relay.
export const createCodeExecutionHandler = () => (socket) => ({ roomId, result } = {}) => {
  if (!socket.rooms.has(roomId)) return;
  socket.to(roomId).emit("execution-result", result);
};
