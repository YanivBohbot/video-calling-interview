import express from "express";

export const createStreamRouter = ({ streamController }) => {
  const router = express.Router();
  router.get("/token", streamController.token);
  return router;
};
