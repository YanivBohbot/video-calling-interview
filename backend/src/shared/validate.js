import { ValidationError } from "./errors.js";

// Express middleware validating parts of the request against Zod schemas.
//   router.post("/", validate({ body: createSchema }), controller.create)
// On failure the first issue's message becomes a 400 — schemas carry client-facing
// messages. It only validates: the request is left untouched (req.query is read-only
// in Express 5), and keys a schema doesn't name are allowed.
export const validate = (schemas) => (req, res, next) => {
  for (const part of ["params", "query", "body"]) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) return next(new ValidationError(result.error.issues[0].message));
  }
  return next();
};
