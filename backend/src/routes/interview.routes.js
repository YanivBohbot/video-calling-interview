import express from "express";

export const createInterviewRouter = ({ interviewController }) => {
  const router = express.Router();
  // Aggregate routes — must be declared before /:id to avoid shadowing.
  router.get("/stats", interviewController.stats);
  router.get("/activity", interviewController.activity);
  router.get("/", interviewController.list);
  router.post("/", interviewController.create);
  router.get("/:id", interviewController.get);
  router.patch("/:id/status", interviewController.updateStatus);
  router.patch("/:id", interviewController.update);
  router.delete("/:id", interviewController.remove);
  return router;
};
