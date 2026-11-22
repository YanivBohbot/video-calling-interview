import { createAgent } from "langchain";
import { z } from "zod";
import { createRunCodeTool, createReadCandidateCodeTool } from "../tools/index.js";
import {
  createCallBudget,
  withFallback,
  createLoggingMiddleware,
  requireToolBeforeResponse,
} from "../middleware/index.js";
import { reportFormat } from "./report.js";
import { COACH_PROMPT, buildCoachInput } from "./prompts.js";

// An invalid structured answer costs one more model call (LangChain retries it), hence 8.
const MODEL_CALLS = 8;
const TOOL_CALLS = 10;
const RECURSION_LIMIT = 40; // graph steps (~2-3 per loop here), above MODEL_CALLS loops

export class CoachFailedError extends Error {
  constructor(message = "The coach produced no report", options) {
    super(message, options);
    this.name = "CoachFailedError";
  }
}

const contextSchema = z.object({ code: z.string(), language: z.string() });

// The practice coach: a ReAct agent with a structured response (the report). It runs the
// candidate's final code on cases it invents; the report keeps only tests that really ran.
export const createPracticeCoach = ({ model, fallbackModel, runCode, languages, log = () => {} }) => {
  const review = async ({ transcript, code, language }) => {
    const runs = new Map(); // runId → output, for this review only
    const agent = createAgent({
      model,
      tools: [
        createRunCodeTool({ runCode, languages, onRun: ({ runId, output }) => runs.set(runId, output) }),
        createReadCandidateCodeTool(),
      ],
      systemPrompt: COACH_PROMPT,
      responseFormat: reportFormat,
      contextSchema,
      middleware: [
        // Not turnLimits(): its after_model hooks break the structured-answer retry (see budget.js).
        createCallBudget({ modelCalls: MODEL_CALLS, toolCalls: TOOL_CALLS }),
        // No report before at least one real run of the candidate's code.
        requireToolBeforeResponse({ tool: "run_code" }),
        ...withFallback(fallbackModel),
        createLoggingMiddleware({ agent: "practiceCoach", log }),
      ],
    });

    let result;
    try {
      result = await agent.invoke(
        { messages: [{ role: "user", content: buildCoachInput({ transcript, code, language }) }] },
        { context: { code: code ?? "", language }, recursionLimit: RECURSION_LIMIT },
      );
    } catch (err) {
      throw new CoachFailedError("The coach failed", { cause: err });
    }
    const report = result?.structuredResponse;
    if (!report) throw new CoachFailedError();
    // Honest report: drop tests the model never ran, let each run back one test only, and
    // show what the code really printed.
    const cited = new Set();
    const testsRun = report.testsRun
      .filter((test) => runs.has(test.runId) && !cited.has(test.runId) && cited.add(test.runId))
      .map((test) => ({ ...test, actual: runs.get(test.runId) }));
    return { ...report, testsRun };
  };

  return { review };
};
