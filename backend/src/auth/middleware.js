import { AppError, InternalError, UnauthorizedError } from "../shared/errors.js";

// Resolves the caller and sets `req.principal`, or answers 401.
export const authenticate = (resolver) => async (req, res, next) => {
  try {
    const principal = await resolver.fromRequest(req);
    if (!principal) return next(new UnauthorizedError("Unauthorized"));
    req.principal = principal;
    return next();
  } catch (err) {
    return next(err instanceof AppError ? err : new InternalError("Auth error", { cause: err }));
  }
};

// Lets only the given principal kinds through (e.g. requireKind("interviewer", "demo")).
export const requireKind =
  (...kinds) =>
  (req, res, next) =>
    kinds.includes(req.principal?.kind) ? next() : next(new AppError(403, "Forbidden"));
