import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { errorHandler, notFoundHandler } from "./shared/errorHandler.js";
import { authenticate } from "./auth/middleware.js";

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
// Per client IP, on the public demo-token endpoint.
const DEFAULT_DEMO_RATE_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };

const jsonRateLimit = (options) =>
  rateLimit({
    ...options,
    standardHeaders: "draft-6",
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ message: "Too many requests, please try again later" }),
  });

// Builds the Express app from the container. No listen() here, so tests can drive it
// with Supertest. Each feature contributes one router in `container.routers`.
export const createApp = (
  container,
  { apiRateLimit = DEFAULT_API_RATE_LIMIT, demoRateLimit = DEFAULT_DEMO_RATE_LIMIT } = {},
) => {
  const { config, routers = {}, auth } = container;
  // Fail closed: an app without an identity resolver would serve /api to anyone.
  if (!auth?.resolver) throw new Error("createApp: container.auth.resolver is required");
  const app = express();

  // Security headers (nosniff, frame options, HSTS…) and no X-Powered-By.
  app.use(helmet());
  // Before the limiter, so a 429 still carries CORS headers the browser can read.
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  // Before body parsing, so a flood is rejected without reading bodies.
  app.use("/api", jsonRateLimit(apiRateLimit));
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.status(200).json({ msg: "success from backedn" });
  });

  // Public: the demo-token endpoint. Everything else under /api needs a principal.
  if (routers.auth) app.use("/api/auth", jsonRateLimit(demoRateLimit), routers.auth);
  const authenticated = authenticate(auth.resolver);

  for (const [name, path] of MOUNTS) {
    const router = routers[name];
    if (router) app.use(path, authenticated, router);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
