import { createAgent, dynamicSystemPromptMiddleware, ToolMessage } from "langchain";
import { z } from "zod";
import {
  createRunCodeTool,
  createFindProblemTool,
  createReadCandidateCodeTool,
  createEndSessionTool,
  END_SESSION_TOOL,
} from "../tools/index.js";
import { turnLimits, isLimitMessage, withFallback, createLoggingMiddleware } from "../middleware/index.js";
import { buildInterviewerPrompt } from "./prompts.js";

// Per-turn budget (spec: an agent loop must never run unbounded).
const MODEL_CALLS_PER_TURN = 6;
const TOOL_CALLS_PER_TURN = 8;
// Graph steps, not model calls: each loop passes ~5 nodes (limit middlewares, model, tools),
// so this sits above MODEL_CALLS_PER_TURN loops; the model-call limit is the real cap.
const RECURSION_LIMIT = 50;

// Given per call, never stored in checkpoints.
const contextSchema = z.object({
  sessionId: z.string(),
  role: z.string(),
  interviewType: z.string(),
  code: z.string(),
  language: z.string(),
});

const CANCELLED_TOOL_RESULT = "Cancelled: the candidate disconnected before this finished.";

const threadOf = (sessionId) => ({ configurable: { thread_id: `practice:${sessionId}` } });

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part?.type === "text" ? part.text : "")).join("");
  return "";
};

const hasToolCalls = (message) => (message.tool_calls?.length ?? 0) > 0 || (message.tool_call_chunks?.length ?? 0) > 0;

// The practice interviewer: a ReAct agent (createAgent) that talks with the candidate,
// reads and runs their code, and decides when the session is over.
// `model` / `fallbackModel` are "provider:model" strings or chat model instances (tests).
export const createPracticeInterviewer = ({
  model,
  fallbackModel,
  runCode,
  languages,
  searchProblems,
  checkpointer,
  log = () => {},
}) => {
  const agent = createAgent({
    model,
    tools: [
      createFindProblemTool({ searchProblems }),
      createReadCandidateCodeTool(),
      createRunCodeTool({ runCode, languages }),
      createEndSessionTool(),
    ],
    contextSchema,
    checkpointer,
    middleware: [
      dynamicSystemPromptMiddleware((_state, runtime) => buildInterviewerPrompt(runtime.context)),
      ...turnLimits({ modelCalls: MODEL_CALLS_PER_TURN, toolCalls: TOOL_CALLS_PER_TURN }),
      ...withFallback(fallbackModel),
      createLoggingMiddleware({ agent: "practiceInterviewer", log }),
    ],
  });

  // A turn aborted during a tool call (candidate disconnected) leaves an AI message whose
  // tool calls have no result; OpenAI rejects such a history (400), which would break the
  // session for good. Answer each of them before the next turn.
  const repairUnansweredToolCalls = async (sessionId) => {
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

  // One candidate message → events: { type: "token", text } (the answer as it is written),
  // { type: "tool", name } (a tool the agent used), then { type: "done", ended, limited }.
  // Aborting `signal` (candidate disconnected) stops the loop; the iteration then throws.
  async function* streamTurn({ sessionId, text, code, language, role, interviewType, signal }) {
    await repairUnansweredToolCalls(sessionId);
    let ended = false;
    let limited = false;
    const stream = await agent.stream(
      { messages: [{ role: "user", content: text }] },
      {
        ...threadOf(sessionId),
        context: { sessionId, role, interviewType, code, language },
        recursionLimit: RECURSION_LIMIT,
        streamMode: ["messages", "updates"],
        signal,
      },
    );
    for await (const [mode, chunk] of stream) {
      if (mode === "messages") {
        const [message, metadata] = chunk;
        // Model tokens only (the limit message comes from a middleware node, not the model).
        if (metadata?.langgraph_node !== "model_request" || message.type !== "ai" || hasToolCalls(message)) continue;
        const token = textOf(message.content);
        if (token) yield { type: "token", text: token };
        continue;
      }
      for (const [node, update] of Object.entries(chunk)) {
        for (const message of update?.messages ?? []) {
          if (node === "tools" && message.type === "tool") {
            if (message.name === END_SESSION_TOOL) ended = true;
            yield { type: "tool", name: message.name };
          } else if (isLimitMessage(message)) {
            limited = true;
          }
        }
      }
    }
    yield { type: "done", ended, limited };
  }

  // The conversation as the candidate saw it: their messages and the interviewer's answers.
  const history = async (sessionId) => {
    const state = await agent.getState(threadOf(sessionId));
    const messages = state?.values?.messages ?? [];
    return messages.flatMap((message) => {
      if (message.type === "human") return [{ role: "candidate", text: textOf(message.content) }];
      if (message.type !== "ai" || isLimitMessage(message)) return [];
      const text = textOf(message.content);
      return text && !hasToolCalls(message) ? [{ role: "interviewer", text }] : [];
    });
  };

  return { streamTurn, history };
};
