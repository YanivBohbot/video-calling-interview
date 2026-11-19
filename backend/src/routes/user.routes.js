import express from "express";
import { validate } from "../shared/validate.js";
import { createUserBody, updateProfileBody } from "../validators/user.schemas.js";

export const createUserRouter = ({ userController }) => {
  const router = express.Router();
  router.get("/", userController.list);
  router.post("/", validate({ body: createUserBody }), userController.create);
  // Profile endpoints — must come before any /:id route to avoid shadowing.
  router.get("/by-clerk/:clerkId", userController.getByClerkId);
  router.put("/by-clerk/:clerkId", validate({ body: updateProfileBody }), userController.update);
  router.get("/by-clerk/:clerkId/stats", userController.stats);
  return router;
};
