import express from "express";
import { validate } from "../shared/validate.js";
import { requireKind } from "../auth/middleware.js";
import { DEMO, INTERVIEWER } from "../auth/principal.js";
import { createInterviewBody, updateInterviewBody, updateStatusBody } from "../validators/interview.schemas.js";

export const createInterviewRouter = ({ interviewController }) => {
  const router = express.Router();
  const owners = requireKind(INTERVIEWER, DEMO);

  // The room is the only route an invited candidate may use (any principal; checked in the service).
  router.get("/:id/room", interviewController.room);

  // Aggregate routes — must be declared before /:id to avoid shadowing.
  router.get("/stats", owners, interviewController.stats);
  router.get("/activity", owners, interviewController.activity);
  router.get("/", owners, interviewController.list);
  router.post("/", owners, validate({ body: createInterviewBody }), interviewController.create);
  router.post("/:id/invite", owners, interviewController.invite);
  router.get("/:id", owners, interviewController.get);
  router.patch("/:id/status", owners, validate({ body: updateStatusBody }), interviewController.updateStatus);
  router.patch("/:id", owners, validate({ body: updateInterviewBody }), interviewController.update);
  router.delete("/:id", owners, interviewController.remove);
  return router;
};
