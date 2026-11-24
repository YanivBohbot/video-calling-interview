import { END_SESSION_TOOL } from "../../tools/index.js";
import { isLimitMessage } from "../../middleware/index.js";
import { textOf } from "./messages.js";

// Turns the agent's stream (streamMode ["messages", "updates"]) into the turn's events:
//   { type: "token", text }               the answer, as the model writes it
//   { type: "tool", name, endsSession }   a tool the agent used (endsSession: it was end_session)
//   { type: "done", ended, limited }      last: session over? per-turn limit hit?
export async function* toTurnEvents(stream) {
  let ended = false;
  let limited = false;
  for await (const [mode, chunk] of stream) {
    if (mode === "messages") {
      const [message, metadata] = chunk;
      // Model tokens only (the limit message comes from a middleware node, not the model).
      // Words written before a tool call are kept: the candidate sees them, as in history().
      if (metadata?.langgraph_node !== "model_request" || message.type !== "ai") continue;
      const token = textOf(message.content);
      if (token) yield { type: "token", text: token };
      continue;
    }
    for (const [node, update] of Object.entries(chunk)) {
      for (const message of update?.messages ?? []) {
        if (node === "tools" && message.type === "tool") {
          const endsSession = message.name === END_SESSION_TOOL;
          if (endsSession) ended = true;
          yield { type: "tool", name: message.name, endsSession };
        } else if (isLimitMessage(message)) {
          limited = true;
        }
      }
    }
  }
  yield { type: "done", ended, limited };
}
