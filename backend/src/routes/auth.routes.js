import express from "express";

// Public: mounted without `authenticate`.
export const createAuthRouter = ({ authController }) => {
  const router = express.Router();
  router.post("/demo", authController.demo);
  return router;
};
