import crypto from "node:crypto";
import { Command } from "@langchain/langgraph";
import { AIConfigError, AIProviderError, AIInvalidResponseError, UnknownJobError } from "./errors.js";

// Errors the API maps itself pass through; anything else from the pipeline is a provider failure.
const passThrough = (err) => err instanceof AIInvalidResponseError || err instanceof AIConfigError;

// Public API of the question generator: start a draft (runs until the human-approval
// interrupt) and resume it with the interviewer's decision. A job is one LangGraph
// thread, addressed as `${interviewId}:${jobId}` — a jobId minted for one interview
// resolves to nothing for any other.
//
// `graph` is the compiled workflow (graph/workflow.js); `context` its runtime dependencies
// (QuestionGenContext), passed on every invoke — start, resume and the finalize retry.
export const createQuestionGenerator = ({ graph, context }) => {
  const threadConfig = (interviewId, jobId) => ({
    configurable: { thread_id: `${interviewId}:${jobId}` },
    context,
  });

  const start = async ({ interviewId, role, interviewType, count }) => {
    const jobId = crypto.randomUUID();
    let result;
    try {
      result = await graph.invoke({ interviewId, role, interviewType, count }, threadConfig(interviewId, jobId));
    } catch (err) {
      if (passThrough(err)) throw err;
      throw new AIProviderError(err.message);
    }
    const pending = result.__interrupt__?.[0]?.value;
    if (!pending) throw new AIProviderError("Graph finished without reaching approval");
    return { jobId, draftQuestions: pending.draftQuestions, plan: pending.plan };
  };

  const resume = async ({ interviewId, jobId, approved, questions }) => {
    const config = threadConfig(interviewId, jobId);
    // Resuming a thread that isn't paused at approval (never started, or already
    // resolved) would silently no-op and look like success — refuse it instead.
    const snapshot = await graph.getState(config);
    // Parked at finalize = the human already approved but the DB write failed;
    // retry the write with the recorded approval rather than stranding the job.
    if (snapshot.next?.includes("finalize")) {
      try {
        await graph.invoke(null, config);
      } catch (err) {
        throw new AIProviderError(err.message);
      }
      return { approved: true };
    }
    if (!snapshot.next?.includes("humanApproval")) {
      throw new UnknownJobError(`No pending approval for job ${jobId}`);
    }
    try {
      await graph.invoke(new Command({ resume: { approved, questions } }), config);
    } catch (err) {
      if (passThrough(err)) throw err;
      throw new AIProviderError(err.message);
    }
    return { approved };
  };

  return { start, resume };
};
