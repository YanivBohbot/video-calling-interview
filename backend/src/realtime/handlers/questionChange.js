import { sanitizeAskedQuestion, setCurrentQuestion } from "../roomQuestions.js";

// The interviewer asks a question: everyone in the room (sender included) sees it.
export const createQuestionChangeHandler = ({ io, roomQuestions }) => (socket) => ({ roomId, question } = {}) => {
  if (!socket.rooms.has(roomId)) return;
  const clean = sanitizeAskedQuestion(question);
  if (!clean) return;
  setCurrentQuestion(roomQuestions, roomId, clean);
  io.to(roomId).emit("question-update", clean);
};
