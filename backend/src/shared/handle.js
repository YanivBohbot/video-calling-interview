import { AppError, InternalError } from "./errors.js";

// Wraps a controller method: known AppErrors reach the error handler as-is, anything
// unexpected becomes a 500 with `fallbackMessage` so internals never reach the client.
export const handle = (fallbackMessage, fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err instanceof AppError ? err : new InternalError(fallbackMessage, { cause: err }));
  }
};
