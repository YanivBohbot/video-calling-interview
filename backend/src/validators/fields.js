import { z } from "zod";

// Field builders whose every failure (missing, wrong type, empty) reports `message`.
export const requiredString = (message) =>
  z.string({ required_error: message, invalid_type_error: message }).min(1, message);

export const optionalString = (message) => z.string({ invalid_type_error: message }).nullish();
