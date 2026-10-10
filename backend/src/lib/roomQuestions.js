const CATEGORIES = new Set(["technical", "behavioral", "system-design"]);
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const MAX_TEXT = 2000;

// Only what the candidate may see crosses the socket: no LeetCode source, no extras.
export const sanitizeAskedQuestion = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const { index, text, category, difficulty } = raw;
  if (!Number.isInteger(index) || index < 0) return null;
  if (typeof text !== "string" || !text.trim()) return null;
  if (!CATEGORIES.has(category) || !DIFFICULTIES.has(difficulty)) return null;
  return { index, text: text.slice(0, MAX_TEXT), category, difficulty };
};

export const setCurrentQuestion = (map, roomId, question) => map.set(roomId, question);
export const getCurrentQuestion = (map, roomId) => map.get(roomId);
export const clearCurrentQuestion = (map, roomId) => map.delete(roomId);
