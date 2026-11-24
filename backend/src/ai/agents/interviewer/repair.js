import { ToolMessage } from "langchain";
import { threadOf } from "./messages.js";

const CANCELLED_TOOL_RESULT = "Cancelled: the candidate disconnected before this finished.";

// A turn aborted during a tool call (candidate disconnected) leaves an AI message whose
// tool calls have no result; OpenAI rejects such a history (400), which would break the
// session for good. This answers each of them, as if the "tools" node had, before the next turn.
export const repairUnansweredToolCalls = async (agent, sessionId) => {
  const messages = (await agent.getState(threadOf(sessionId)))?.values?.messages ?? [];
  const answered = new Set(messages.filter((m) => m.type === "tool").map((m) => m.tool_call_id));
  const missing = messages
    .filter((m) => m.type === "ai")
    .flatMap((m) => m.tool_calls ?? [])
    .filter((call) => !answered.has(call.id));
  if (missing.length === 0) return;
  await agent.updateState(
    threadOf(sessionId),
    {
      messages: missing.map(
        (call) => new ToolMessage({ tool_call_id: call.id, name: call.name, content: CANCELLED_TOOL_RESULT }),
      ),
    },
    "tools",
  );
};
