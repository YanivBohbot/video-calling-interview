import { createMiddleware } from "langchain";

// Keeps the structured response (responseFormat) away from the model until `tool` has run
// at least once in this run: the model must act before it may conclude. Used by the coach,
// whose report must rest on code it really executed (gpt-4o-mini otherwise often writes the
// report straight away). Stateless: it reads the run's messages.
export const requireToolBeforeResponse = ({ tool }) =>
  createMiddleware({
    name: "RequireToolBeforeResponse",
    wrapModelCall: (request, handler) => {
      const ran = (request.state?.messages ?? []).some((message) => message.type === "tool" && message.name === tool);
      // [] = no strategy; `undefined` would fall back to the agent's own responseFormat.
      return handler(ran ? request : { ...request, responseFormat: [] });
    },
  });
