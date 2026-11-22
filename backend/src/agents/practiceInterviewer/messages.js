// Small helpers over LangChain messages, shared by the agent, the repair and the events.

// The checkpointer thread of a practice session.
export const threadOf = (sessionId) => ({ configurable: { thread_id: `practice:${sessionId}` } });

// The text of a message (string content, or the text parts of a multi-part content).
export const textOf = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part?.type === "text" ? part.text : "")).join("");
  return "";
};

// An AI message (or streamed chunk) that calls tools rather than answering the candidate.
export const hasToolCalls = (message) =>
  (message.tool_calls?.length ?? 0) > 0 || (message.tool_call_chunks?.length ?? 0) > 0;
