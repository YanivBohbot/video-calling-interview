import express from "express";
import { validate } from "../shared/validate.js";
import { requireKind } from "../auth/middleware.js";
import { DEMO, INTERVIEWER } from "../auth/principal.js";
import { updateProfileBody } from "../validators/user.schemas.js";

// Only the caller's own profile: /me. Candidates have no profile.
export const createUserRouter = ({ userController }) => {
  const router = express.Router();
  router.use(requireKind(INTERVIEWER, DEMO));
  router.get("/me", userController.getMe);
  router.put("/me", validate({ body: updateProfileBody }), userController.updateMe);
  router.get("/me/stats", userController.myStats);
  return router;
};
