import { AppError } from "./errors.js";

export const notFoundHandler = (req, res) => {
  res.status(404).json({ message: "Not found" });
};

// Express recognises an error middleware by its 4 parameters — keep `next`.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    if (err.status >= 500) console.error(`${err.message}:`, err.cause ?? err);
    return res.status(err.status).json({ message: err.message, ...err.extras });
  }
  // Malformed JSON bodies from express.json() carry a 4xx status.
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  // Other client errors raised by Express / body-parser (413 too large, 415 encoding…):
  // keep their status, but not their raw message.
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ message: "Invalid request" });
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({ message: "Internal server error" });
};
