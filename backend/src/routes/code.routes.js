import express from "express";
import { validate } from "../shared/validate.js";
import { runCodeBody } from "../validators/code.schemas.js";

export const createCodeRouter = ({ codeController }) => {
  const router = express.Router();
  router.post("/run", validate({ body: runCodeBody }), codeController.run);
  return router;
};
