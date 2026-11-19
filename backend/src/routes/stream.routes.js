import express from "express";
import { validate } from "../shared/validate.js";
import { streamTokenQuery } from "../validators/stream.schemas.js";

export const createStreamRouter = ({ streamController }) => {
  const router = express.Router();
  router.get("/token", validate({ query: streamTokenQuery }), streamController.token);
  return router;
};
