import express from "express";

export const createUserRouter = ({ userController }) => {
  const router = express.Router();
  router.get("/", userController.list);
  router.post("/", userController.create);
  // Profile endpoints — must come before any /:id route to avoid shadowing.
  router.get("/by-clerk/:clerkId", userController.getByClerkId);
  router.put("/by-clerk/:clerkId", userController.update);
  router.get("/by-clerk/:clerkId/stats", userController.stats);
  return router;
};
