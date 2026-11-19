import { sanitizeAskedQuestion, setCurrentQuestion } from "../roomQuestions.js";
import { isOwnerKind } from "../../auth/principal.js";

// The interviewer asks a question: everyone in the room (sender included) sees it.
// Candidates only receive questions; they can never pick one.
export const createQuestionChangeHandler = ({ io, roomQuestions }) => (socket) => ({ roomId, question } = {}) => {
  if (!isOwnerKind(socket.data.principal) || !socket.rooms.has(roomId)) return;
  const clean = sanitizeAskedQuestion(question);
  if (!clean) return;
  setCurrentQuestion(roomQuestions, roomId, clean);
  io.to(roomId).emit("question-update", clean);
};
