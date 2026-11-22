import express from "express";
import { validate } from "../shared/validate.js";
import { runCodeBody } from "../validators/code.schemas.js";
import { practiceMessageBody, practiceSessionParams, startPracticeBody } from "../validators/practice.schemas.js";

// Mounted on /api/practice behind authenticatePractice (app.js): practice links only.
export const createPracticeRouter = ({ practiceController }) => {
  const router = express.Router();
  const session = validate({ params: practiceSessionParams });
  router.post("/sessions", validate({ body: startPracticeBody }), practiceController.start);
  router.get("/sessions/:sid", session, practiceController.get);
  router.post("/sessions/:sid/messages", session, validate({ body: practiceMessageBody }), practiceController.message);
  router.post("/sessions/:sid/finish", session, practiceController.finish);
  router.post("/run", validate({ body: runCodeBody }), practiceController.run);
  return router;
};
