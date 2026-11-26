// How many owner sockets (interviewer / demo) are in each room: the AI avatar is only
// offered to the candidate while this is 0. In memory, like roomQuestions.
export const addOwner = (map, roomId) => {
  const count = (map.get(roomId) ?? 0) + 1;
  map.set(roomId, count);
  return count;
};

// Returns the new count; never goes below 0, and an empty room leaves no entry.
export const removeOwner = (map, roomId) => {
  const count = Math.max((map.get(roomId) ?? 0) - 1, 0);
  if (count === 0) map.delete(roomId);
  else map.set(roomId, count);
  return count;
};

export const isOwnerPresent = (map, roomId) => (map.get(roomId) ?? 0) > 0;
