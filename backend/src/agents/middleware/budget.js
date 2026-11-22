import { createMiddleware } from "langchain";

// LangGraph rethrows a copy of errors raised in a node: match on `name`, not instanceof.
export class BudgetExceededError extends Error {
  constructor(kind, limit) {
    super(`Agent ${kind}-call budget of ${limit} exceeded`);
    this.name = "BudgetExceededError";
  }
}

// A hard cap on model and tool calls, written with wrap hooks only. Use it instead of
// turnLimits() on an agent with a structured responseFormat: in langchain 1.5, any
// after_model middleware (both built-in limit middlewares) breaks the automatic retry of an
// invalid structured answer (InvalidUpdateError on "jumpTo").
// The counters belong to the middleware instance: build one agent per run.
export const createCallBudget = ({ modelCalls, toolCalls }) => {
  let models = 0;
  let tools = 0;
  return createMiddleware({
    name: "CallBudget",
    wrapModelCall: (request, handler) => {
      if (++models > modelCalls) throw new BudgetExceededError("model", modelCalls);
      return handler(request);
    },
    wrapToolCall: (request, handler) => {
      if (++tools > toolCalls) throw new BudgetExceededError("tool", toolCalls);
      return handler(request);
    },
  });
};
