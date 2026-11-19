import express from "express";
import { requireIdentity } from "../auth/requireIdentity.js";

// Mounted at /api/interviews/:id/questions — mergeParams exposes :id to the handlers.
export const createQuestionRouter = ({ questionController, identityStrategy }) => {
  const router = express.Router({ mergeParams: true });
  const identified = requireIdentity(identityStrategy);
  router.post("/generate", identified, questionController.generate);
  router.post("/approve", identified, questionController.approve);
  return router;
};
