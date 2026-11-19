import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
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

// Per client IP, across all /api routes. The AI routes keep their own, stricter limiter.
const DEFAULT_API_RATE_LIMIT = { limit: 1000, windowMs: 15 * 60 * 1000 };

// Builds the Express app from the container. No listen() here, so tests can drive it
// with Supertest. Each feature contributes one router in `container.routers`.
export const createApp = (container, { apiRateLimit = DEFAULT_API_RATE_LIMIT } = {}) => {
  const { config, routers = {} } = container;
  const app = express();

  // Security headers (nosniff, frame options, HSTS…) and no X-Powered-By.
  app.use(helmet());
  // Before the limiter, so a 429 still carries CORS headers the browser can read.
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  // Before body parsing, so a flood is rejected without reading bodies.
  app.use(
    "/api",
    rateLimit({
      ...apiRateLimit,
      standardHeaders: "draft-6",
      legacyHeaders: false,
      handler: (req, res) => res.status(429).json({ message: "Too many requests, please try again later" }),
    }),
  );
  app.use(express.json());

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
