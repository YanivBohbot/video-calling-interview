import express from "express";
import { requireKind } from "../auth/middleware.js";
import { DEMO, INTERVIEWER } from "../auth/principal.js";
import { validate } from "../shared/validate.js";
import { approveQuestionsBody } from "../validators/question.schemas.js";

// Mounted at /api/interviews/:id/questions — mergeParams exposes :id to the handlers.
export const createQuestionRouter = ({ questionController }) => {
  const router = express.Router({ mergeParams: true });
  const owners = requireKind(INTERVIEWER, DEMO);
  router.post("/generate", owners, questionController.generate);
  router.post("/approve", owners, validate({ body: approveQuestionsBody }), questionController.approve);
  return router;
};
