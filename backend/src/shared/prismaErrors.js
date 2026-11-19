import { ConflictError, NotFoundError } from "./errors.js";

// Translates the Prisma error codes the API cares about into AppErrors;
// anything else is rethrown untouched (and becomes a generic 500 upstream).
//   P2025 — record to update/delete not found
//   P2002 — unique constraint violated
export const translatePrismaError = (err, { notFoundMessage = "Not found" } = {}) => {
  if (err?.code === "P2025") throw new NotFoundError(notFoundMessage);
  if (err?.code === "P2002") throw new ConflictError();
  throw err;
};
