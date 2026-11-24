import { sanitizeAskedQuestion, setCurrentQuestion, recordAskedQuestion } from "../roomQuestions.js";
import { isOwnerKind } from "../../auth/principal.js";

// The interviewer asks a question: everyone in the room (sender included) sees it.
// Candidates only receive questions; they can never pick one.
export const createQuestionChangeHandler = ({ io, roomQuestions, askedQuestions }) => (socket) => ({ roomId, question } = {}) => {
  if (!isOwnerKind(socket.data.principal) || !socket.rooms.has(roomId)) return;
  const clean = sanitizeAskedQuestion(question);
  if (!clean) return;
  setCurrentQuestion(roomQuestions, roomId, clean);
  io.to(roomId).emit("question-update", clean);
  io.to(roomId).emit("questions-asked", recordAskedQuestion(askedQuestions, roomId, clean));
};
