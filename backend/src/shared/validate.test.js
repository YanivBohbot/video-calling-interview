import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate } from "./validate.js";
import { ValidationError } from "./errors.js";

const run = (middleware, req) => {
  const next = vi.fn();
  middleware(req, {}, next);
  return next.mock.calls[0];
};

describe("validate middleware", () => {
  const body = z.object({ name: z.string({ required_error: "Name is required", invalid_type_error: "Name is required" }) });

  it("calls next() with nothing when the request is valid", () => {
    expect(run(validate({ body }), { body: { name: "Ada" } })).toEqual([]);
  });

  it("turns the first issue into a ValidationError carrying the schema's message", () => {
    const [err] = run(validate({ body }), { body: { name: 42 } });
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe("Name is required");
  });

  it("treats a missing body as an empty object, so field messages still apply", () => {
    const [err] = run(validate({ body }), {});
    expect(err.message).toBe("Name is required");
  });

  it("validates params and query too", () => {
    const params = z.object({ id: z.string().min(3, "bad id") });
    const query = z.object({ userId: z.string({ invalid_type_error: "bad query" }) });
    expect(run(validate({ params }), { params: { id: "x" } })[0].message).toBe("bad id");
    expect(run(validate({ query }), { query: { userId: ["a", "b"] } })[0].message).toBe("bad query");
  });

  it("does not modify the request", () => {
    const req = { body: { name: "Ada", extra: true } };
    run(validate({ body }), req);
    expect(req.body).toEqual({ name: "Ada", extra: true });
  });
});
