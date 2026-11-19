import express from "express";

export const createSessionRouter = ({ sessionController }) => {
  const router = express.Router();
  router.get("/", sessionController.list);
  router.get("/:id", sessionController.get);
  return router;
};
