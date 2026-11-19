import express from "express";
import { validate } from "../shared/validate.js";
import { createInterviewBody, updateInterviewBody, updateStatusBody } from "../validators/interview.schemas.js";

export const createInterviewRouter = ({ interviewController }) => {
  const router = express.Router();
  // Aggregate routes — must be declared before /:id to avoid shadowing.
  router.get("/stats", interviewController.stats);
  router.get("/activity", interviewController.activity);
  router.get("/", interviewController.list);
  router.post("/", validate({ body: createInterviewBody }), interviewController.create);
  router.get("/:id", interviewController.get);
  router.patch("/:id/status", validate({ body: updateStatusBody }), interviewController.updateStatus);
  router.patch("/:id", validate({ body: updateInterviewBody }), interviewController.update);
  router.delete("/:id", interviewController.remove);
  return router;
};
