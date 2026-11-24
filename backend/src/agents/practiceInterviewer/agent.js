import { createAgent, dynamicSystemPromptMiddleware } from "langchain";
import { z } from "zod";
import {
  createRunCodeTool,
  createFindProblemTool,
  createReadCandidateCodeTool,
  createEndSessionTool,
} from "../tools/index.js";
import { turnLimits, isLimitMessage, withFallback, createLoggingMiddleware } from "../middleware/index.js";
import { buildInterviewerPrompt } from "./prompts.js";
import { threadOf, textOf } from "./messages.js";
import { repairUnansweredToolCalls } from "./repair.js";
import { toTurnEvents } from "./events.js";

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
  // The interview's question, or null: the agent then finds its own problem.
  question: z.object({ text: z.string(), category: z.string(), difficulty: z.string() }).nullable(),
});

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

  // One candidate message → token / tool / done events (see events.js).
  // Aborting `signal` (candidate disconnected) stops the loop; the iteration then throws.
  async function* streamTurn({ sessionId, text, code, language, role, interviewType, question = null, signal }) {
    await repairUnansweredToolCalls(agent, sessionId);
    const stream = await agent.stream(
      { messages: [{ role: "user", content: text }] },
      {
        ...threadOf(sessionId),
        context: { sessionId, role, interviewType, code, language, question },
        recursionLimit: RECURSION_LIMIT,
        streamMode: ["messages", "updates"],
        signal,
      },
    );
    yield* toTurnEvents(stream);
  }

  // The conversation as the candidate saw it: their messages and the interviewer's answers.
  const history = async (sessionId) => {
    const state = await agent.getState(threadOf(sessionId));
    const messages = state?.values?.messages ?? [];
    return messages.flatMap((message) => {
      if (message.type === "human") return [{ role: "candidate", text: textOf(message.content) }];
      if (message.type !== "ai" || isLimitMessage(message)) return [];
      // An answer, or the words written before a tool call ("Let me run your code.").
      const text = textOf(message.content);
      return text ? [{ role: "interviewer", text }] : [];
    });
  };

  return { streamTurn, history };
};
