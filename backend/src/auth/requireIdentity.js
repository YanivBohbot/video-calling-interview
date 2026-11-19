import { AppError, InternalError, UnauthorizedError } from "../shared/errors.js";

// Middleware: resolves the caller with the given identity strategy and sets `req.user`.
export const requireIdentity = (strategy) => async (req, res, next) => {
  try {
    const identity = await strategy.resolveIdentity(req);
    if (!identity) return next(new UnauthorizedError("Unauthorized"));
    req.user = identity;
    return next();
  } catch (err) {
    return next(err instanceof AppError ? err : new InternalError("Auth error", { cause: err }));
  }
};
