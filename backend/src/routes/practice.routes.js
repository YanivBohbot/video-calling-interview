import express from "express";
import { validate } from "../shared/validate.js";
import { requireKind } from "../auth/middleware.js";
import { CANDIDATE, DEMO, INTERVIEWER } from "../auth/principal.js";
import { practiceMessageBody, practiceSessionParams, startPracticeBody } from "../validators/practice.schemas.js";

// The AI interviewer of a room, mounted on /api/interviews/:id/ai (app.js). The invited
// candidate and the interview's owner may come in; the service decides who may do what.
export const createPracticeRouter = ({ practiceController }) => {
  const router = express.Router({ mergeParams: true });
  router.use(requireKind(CANDIDATE, INTERVIEWER, DEMO));
  const session = validate({ params: practiceSessionParams });
  router.post("/sessions", validate({ body: startPracticeBody }), practiceController.start);
  // Before /sessions/:sid, which would take "current" for a session id.
  router.get("/sessions/current", practiceController.current);
  router.get("/sessions/:sid", session, practiceController.get);
  router.post("/sessions/:sid/messages", session, validate({ body: practiceMessageBody }), practiceController.message);
  router.post("/sessions/:sid/finish", session, practiceController.finish);
  router.post("/sessions/:sid/report", session, practiceController.retryReport);
  router.post("/sessions/:sid/avatar-token", session, practiceController.avatarToken);
  return router;
};
