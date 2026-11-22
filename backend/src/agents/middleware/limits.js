import { modelCallLimitMiddleware, toolCallLimitMiddleware } from "langchain";

// What modelCallLimitMiddleware({ exitBehavior: "end" }) writes as the last AI message
// when it stops a run (checked against langchain 1.5).
export const MODEL_LIMIT_PREFIX = "Model call limits exceeded";

export const isLimitMessage = (message) =>
  message?.type === "ai" && typeof message.content === "string" && message.content.startsWith(MODEL_LIMIT_PREFIX);

// Caps one turn (one run) of an agent loop: past `modelCalls` the run ends; past
// `toolCalls` further tool calls are refused and the model has to answer.
export const turnLimits = ({ modelCalls, toolCalls }) => [
  modelCallLimitMiddleware({ runLimit: modelCalls, exitBehavior: "end" }),
  toolCallLimitMiddleware({ runLimit: toolCalls, exitBehavior: "continue" }),
];
