import { createMiddleware } from "langchain";

// Makes the model call `tool` (toolChoice) until it has run once in the thread. Used by the
// avatar interviewer: gpt-4o-mini sometimes wrote "(presenting question 0)" instead of calling
// present_question, and the avatar said it aloud. `when(request)`: whether it applies to this
// run. Stateless: it reads the thread's messages, so a resumed session is never forced again.
export const forceToolFirst = ({ tool, when = () => true }) =>
  createMiddleware({
    name: "ForceToolFirst",
    wrapModelCall: (request, handler) => {
      const ran = (request.state?.messages ?? []).some((message) => message.type === "tool" && message.name === tool);
      if (ran || !when(request)) return handler(request);
      return handler({ ...request, toolChoice: { type: "function", function: { name: tool } } });
    },
  });
