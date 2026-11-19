import { describe, it, expect, vi } from "vitest";
import { NotFoundError, RateLimitError, AppError, InternalError } from "./errors.js";
import { handle } from "./handle.js";
import { errorHandler, notFoundHandler } from "./errorHandler.js";

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const runHandler = (err) => {
  const res = mockRes();
  errorHandler(err, {}, res, () => {});
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

describe("errorHandler", () => {
  it("maps a NotFoundError to 404 with its message", () => {
    expect(runHandler(new NotFoundError("Interview not found"))).toEqual({
      status: 404,
      body: { message: "Interview not found" },
    });
  });

  it("keeps retryAfter in a rate-limit body", () => {
    expect(runHandler(new RateLimitError("Too many AI generations, slow down", 12))).toEqual({
      status: 429,
      body: { message: "Too many AI generations, slow down", retryAfter: 12 },
    });
  });

  it("exposes an AppError with an arbitrary status", () => {
    expect(runHandler(new AppError(500, "AI not configured: OPENAI_API_KEY missing"))).toEqual({
      status: 500,
      body: { message: "AI not configured: OPENAI_API_KEY missing" },
    });
  });

  it("keeps malformed JSON bodies a 400, as Express answered before", () => {
    const err = Object.assign(new SyntaxError("Unexpected token"), { type: "entity.parse.failed", status: 400 });
    expect(runHandler(err)).toEqual({ status: 400, body: { message: "Invalid JSON body" } });
  });

  it.each([
    ["entity.too.large", 413],
    ["encoding.unsupported", 415],
    ["request.aborted", 400],
  ])("keeps Express's own client-error status for %s instead of a 500", (type, status) => {
    const err = Object.assign(new Error(`raw parser detail for ${type}`), { type, status, expose: true });
    const out = runHandler(err);
    expect(out.status).toBe(status);
    expect(JSON.stringify(out.body)).not.toContain("raw parser detail");
  });

  it("hides a plain Error behind a generic 500", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runHandler(new Error("connection string postgres://u:p@h"))).toEqual({
      status: 500,
      body: { message: "Internal server error" },
    });
  });
});

describe("handle", () => {
  it("turns an unexpected error into the fallback message without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const next = vi.fn();
    await handle("Error fetching interviews", async () => {
      throw new Error("P1001 db down at 10.0.0.1");
    })({}, mockRes(), next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(InternalError);
    const { status, body } = runHandler(err);
    expect(status).toBe(500);
    expect(body).toEqual({ message: "Error fetching interviews" });
    expect(JSON.stringify(body)).not.toContain("P1001");
  });

  it("passes AppErrors through unchanged", async () => {
    const next = vi.fn();
    const original = new NotFoundError("Session not found");
    await handle("Fetch session failed", async () => {
      throw original;
    })({}, mockRes(), next);
    expect(next).toHaveBeenCalledWith(original);
  });
});

describe("notFoundHandler", () => {
  it("answers 404 JSON", () => {
    const res = mockRes();
    notFoundHandler({}, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Not found" });
  });
});
