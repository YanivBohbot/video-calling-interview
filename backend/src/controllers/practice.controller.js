import { handle } from "../shared/handle.js";
import { AppError, InternalError } from "../shared/errors.js";

const AGENT_UNAVAILABLE = "The interviewer is unavailable right now.";

const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// Each agent event becomes one server-sent event: token, tool, done (see the agent's README).
const eventData = (event) => {
  if (event.type === "token") return { text: event.text };
  if (event.type === "tool") return { name: event.name };
  return { ended: event.ended, limited: event.limited };
};

export const createPracticeController = ({ practiceService }) => ({
  start: handle("Error starting the AI interviewer", async (req, res) => {
    res.status(201).json(await practiceService.start(req.principal, req.params.id, req.body));
  }),

  current: handle("Error fetching the AI interviewer session", async (req, res) => {
    res.status(200).json(await practiceService.current(req.principal, req.params.id));
  }),

  get: handle("Error fetching the AI interviewer session", async (req, res) => {
    res.status(200).json(await practiceService.get(req.principal, req.params.id, req.params.sid));
  }),

  finish: handle("Error ending the AI interviewer session", async (req, res) => {
    res.status(200).json(await practiceService.finish(req.principal, req.params.id, req.params.sid));
  }),

  // POST + text/event-stream (the browser reads it with fetch, not EventSource).
  // Refusals happen before the first byte, so they are ordinary JSON errors.
  message: async (req, res, next) => {
    const aborter = new AbortController();
    let events;
    try {
      events = await practiceService.streamMessage(req.principal, req.params.id, req.params.sid, req.body, aborter.signal);
    } catch (err) {
      return next(err instanceof AppError ? err : new InternalError("Error sending message", { cause: err }));
    }
    // Candidate gone (tab closed): stop the agent loop so it stops spending.
    res.on("close", () => {
      if (!res.writableFinished) aborter.abort();
    });
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    try {
      for await (const event of events) sse(res, event.type, eventData(event));
    } catch (err) {
      if (!aborter.signal.aborted) {
        console.error("Practice turn failed:", err.message);
        sse(res, "error", { message: AGENT_UNAVAILABLE });
      }
    }
    res.end();
  },
});
