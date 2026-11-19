import { createQuestionService } from "./question.service.js";
import { createQuestionController } from "./question.controller.js";
import { createQuestionRouter } from "./question.routes.js";

// Wires the AI questions feature. It owns no table: it reads interviews through the
// interviews repository and persists through the agent pipeline (`generation`).
export const createQuestionsModule = ({ interviewRepository, generation, rateLimiter, config, identityStrategy }) => {
  const questionService = createQuestionService({ interviewRepository, generation, rateLimiter, config });
  const questionController = createQuestionController({ questionService });
  const router = createQuestionRouter({ questionController, identityStrategy });
  return { questionService, questionController, router };
};
