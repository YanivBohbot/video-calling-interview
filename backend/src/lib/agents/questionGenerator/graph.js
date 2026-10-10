import crypto from "node:crypto";
import { StateGraph, START, END, MemorySaver, Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createAgent } from "langchain";
import { prisma } from "../../db.js";
import { getLeetCodeTools } from "../leetcodeMcpClient.js";
import { QuestionGenState, DraftResponseSchema, ResearchResponseSchema } from "./state.js";
import { buildResearcherPrompt, buildDrafterPrompt } from "./prompts.js";
import {
  makePlannerNode,
  makeResearcherNode,
  makeDrafterNode,
  validatorNode,
  fallbackNode,
  humanApprovalNode,
  makeFinalizeNode,
} from "./nodes.js";
import { AIProviderError, AIInvalidResponseError, UnknownJobError } from "./errors.js";

const defaultBuildResearcherAgent = async () => {
  const tools = await getLeetCodeTools();
  return createAgent({
    model: `openai:${process.env.AI_MODEL || "gpt-4o-mini"}`,
    tools,
    systemPrompt: buildResearcherPrompt(),
    responseFormat: ResearchResponseSchema,
  });
};

const defaultBuildDrafterAgent = async (useFallbackModel) =>
  createAgent({
    model: `openai:${
      useFallbackModel ? process.env.AI_MODEL_FALLBACK || "gpt-4o" : process.env.AI_MODEL || "gpt-4o-mini"
    }`,
    tools: [],
    systemPrompt: buildDrafterPrompt(),
    responseFormat: DraftResponseSchema,
  });

// The researcher swallows its own errors (grounding is optional), so only the
// drafter carries a retryPolicy for transient LLM failures.
export const buildGraph = ({
  checkpointer,
  buildResearcherAgent = defaultBuildResearcherAgent,
  buildDrafterAgent = defaultBuildDrafterAgent,
  prismaClient = prisma,
} = {}) =>
  new StateGraph(QuestionGenState)
    .addNode("planner", makePlannerNode())
    .addNode("researcher", makeResearcherNode({ buildResearcherAgent }))
    .addNode("drafter", makeDrafterNode({ buildDrafterAgent }), { retryPolicy: { maxAttempts: 3 } })
    .addNode("validator", validatorNode, { ends: ["humanApproval", "drafter", "fallback"] })
    .addNode("fallback", fallbackNode)
    .addNode("humanApproval", humanApprovalNode, { ends: ["finalize", END] })
    .addNode("finalize", makeFinalizeNode({ prisma: prismaClient }))
    .addEdge(START, "planner")
    .addEdge("planner", "researcher")
    .addEdge("researcher", "drafter")
    .addEdge("drafter", "validator")
    .addEdge("fallback", "drafter")
    .addEdge("finalize", END)
    .compile({ checkpointer: checkpointer || new MemorySaver() });

let pgCheckpointer;
export const getCheckpointer = () => {
  if (!pgCheckpointer) pgCheckpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL);
  return pgCheckpointer;
};

export const ensureCheckpointerTables = () => getCheckpointer().setup();

let defaultGraph;
const getDefaultGraph = () => {
  if (!defaultGraph) defaultGraph = buildGraph({ checkpointer: getCheckpointer() });
  return defaultGraph;
};

export const startQuestionGeneration = async ({ interviewId, role, interviewType, count }, { graph } = {}) => {
  const runGraph = graph || getDefaultGraph();
  const jobId = crypto.randomUUID();
  const threadId = `${interviewId}:${jobId}`;
  let result;
  try {
    result = await runGraph.invoke(
      { interviewId, role, interviewType, count },
      { configurable: { thread_id: threadId } },
    );
  } catch (err) {
    if (err instanceof AIInvalidResponseError) throw err;
    throw new AIProviderError(err.message);
  }
  const pending = result.__interrupt__?.[0]?.value;
  if (!pending) throw new AIProviderError("Graph finished without reaching approval");
  return { jobId, draftQuestions: pending.draftQuestions, plan: pending.plan };
};

export const resumeQuestionGeneration = async ({ interviewId, jobId, approved, questions }, { graph } = {}) => {
  const runGraph = graph || getDefaultGraph();
  const config = { configurable: { thread_id: `${interviewId}:${jobId}` } };
  // Resuming a thread that isn't paused at approval (never started, or already
  // resolved) would silently no-op and look like success — refuse it instead.
  const snapshot = await runGraph.getState(config);
  // Parked at finalize = the human already approved but the DB write failed;
  // retry the write with the recorded approval rather than stranding the job.
  if (snapshot.next?.includes("finalize")) {
    try {
      await runGraph.invoke(null, config);
    } catch (err) {
      throw new AIProviderError(err.message);
    }
    return { approved: true };
  }
  if (!snapshot.next?.includes("humanApproval")) {
    throw new UnknownJobError(`No pending approval for job ${jobId}`);
  }
  try {
    await runGraph.invoke(new Command({ resume: { approved, questions } }), config);
  } catch (err) {
    if (err instanceof AIInvalidResponseError) throw err;
    throw new AIProviderError(err.message);
  }
  return { approved };
};
