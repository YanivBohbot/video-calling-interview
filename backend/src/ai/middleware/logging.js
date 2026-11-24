import { createMiddleware } from "langchain";

// Logs each model and tool call (which, how long, whether it failed) — never the
// messages, the code or the tool arguments, which are the candidate's.
export const createLoggingMiddleware = ({ agent, log }) => {
  const timed = async (fields, call) => {
    const started = Date.now();
    try {
      const result = await call();
      log({ agent, ...fields, ms: Date.now() - started, ok: true });
      return result;
    } catch (err) {
      log({ agent, ...fields, ms: Date.now() - started, ok: false });
      throw err;
    }
  };
  return createMiddleware({
    name: "ContentFreeLogging",
    wrapModelCall: (request, handler) => timed({ event: "model" }, () => handler(request)),
    wrapToolCall: (request, handler) => timed({ event: "tool", tool: request.toolCall?.name }, () => handler(request)),
  });
};
