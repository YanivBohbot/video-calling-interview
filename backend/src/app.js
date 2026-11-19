import express from "express";
import cors from "cors";
import { errorHandler, notFoundHandler } from "./shared/errorHandler.js";

// Order matters: the question routes live under /api/interviews/:id/questions and must
// be reached before the interviews router's generic /:id handlers.
const MOUNTS = [
  ["questions", "/api/interviews/:id/questions"],
  ["interviews", "/api/interviews"],
  ["users", "/api/users"],
  ["sessions", "/api/sessions"],
  ["stream", "/api/stream"],
];

// Builds the Express app from the container. No listen() here, so tests can drive it
// with Supertest. Each feature module contributes one router in `container.routers`.
export const createApp = (container) => {
  const { config, routers = {} } = container;
  const app = express();

  app.use(express.json());
  app.use(cors({ origin: config.clientUrl, credentials: true }));

  app.get("/health", (req, res) => {
    res.status(200).json({ msg: "success from backedn" });
  });

  for (const [name, path] of MOUNTS) {
    const router = routers[name];
    if (router) app.use(path, router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
