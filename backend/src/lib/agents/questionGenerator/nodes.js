import { Command, END, interrupt } from "@langchain/langgraph";
import { AIInvalidResponseError } from "./errors.js";
import { collectSeenProblems, pickResearchProblems } from "./sources.js";

// Largest-remainder apportionment: floors each share, then hands the leftover
// slots to the largest fractional parts so the result always sums to `count`.
// Fractions are rounded so float noise (0.6000000000000001 vs 0.5999999999999996)
// can't break real ties; the stable sort then favors earlier-declared categories.
export const distributeCounts = (count, weights) => {
  const categories = Object.keys(weights);
  const raw = categories.map((c) => count * weights[c]);
  const base = raw.map((r) => Math.floor(r + 1e-9));
  const assigned = base.reduce((a, b) => a + b, 0);
  const remaining = count - assigned;
  const remainders = raw.map((r, i) => ({ i, frac: Math.round((r - base[i]) * 1e6) / 1e6 }));
  remainders.sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remaining; k++) base[remainders[k].i] += 1;
  return Object.fromEntries(categories.map((c, i) => [c, base[i]]));
};

const PLANNER_WEIGHTS = {
  technical: { technical: 0.6, behavioral: 0.25, "system-design": 0.15 },
  behavioral: { behavioral: 0.6, technical: 0.3, "system-design": 0.1 },
  "system-design": { "system-design": 0.6, technical: 0.3, behavioral: 0.1 },
};

export const makePlannerNode = () => async (state) => {
  const weights = PLANNER_WEIGHTS[state.interviewType] || PLANNER_WEIGHTS.technical;
  return { plan: { categoryCounts: distributeCounts(state.count, weights) } };
};

// Grounding is optional: an unreachable LeetCode MCP server must degrade to no
// research, never fail the whole generation.
export const makeResearcherNode = ({ buildResearcherAgent, random = Math.random }) => async (state) => {
  const technicalCount = state.plan.categoryCounts.technical || 0;
  if (!technicalCount) return { research: [] };
  try {
    const agent = await buildResearcherAgent();
    const offset = Math.floor(random() * 41);
    const result = await agent.invoke({
      messages: [
        {
          role: "user",
          content: [
            `Role: ${state.role}`,
            `Interview type: ${state.interviewType}`,
            `Technical questions to ground: ${technicalCount}`,
            `Start your first search at offset ${offset} so repeated runs surface different problems.`,
          ].join("\n"),
        },
      ],
    });
    const seen = collectSeenProblems(result.messages);
    return { research: pickResearchProblems(result.structuredResponse?.problems, seen, technicalCount) };
  } catch (err) {
    console.warn("question generator: researcher failed, continuing without grounding:", err.message);
    return { research: [] };
  }
};

const formatResearch = (research) =>
  research.length ? research.map((p) => `- ${p.slug} — ${p.title} (${p.difficulty})`).join("\n") : "none";

export const makeDrafterNode = ({ buildDrafterAgent }) => async (state) => {
  const agent = await buildDrafterAgent(state.useFallbackModel);
  const result = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: [
            `Generate exactly ${state.count} interview questions.`,
            `Role: ${state.role}`,
            `Interview type: ${state.interviewType}`,
            `Category mix: ${JSON.stringify(state.plan.categoryCounts)}`,
            `LeetCode problems you may use (one per technical question):\n${formatResearch(state.research)}`,
            ...(state.validationErrors?.length
              ? [`Your previous draft was rejected: ${state.validationErrors.join("; ")}. Fix these.`]
              : []),
          ].join("\n"),
        },
      ],
    },
    { recursionLimit: 10 },
  );
  return { draftQuestions: result.structuredResponse.questions };
};

const MAX_CONTENT_RETRIES = 2;

const validateContent = (state) => {
  const errors = [];
  if (state.draftQuestions.length !== state.count) {
    errors.push(`expected ${state.count} questions, got ${state.draftQuestions.length}`);
  }
  const seen = new Set();
  for (const q of state.draftQuestions) {
    if (!q.text || !q.text.trim()) errors.push("empty question text");
    const key = q.text.trim().toLowerCase();
    if (seen.has(key)) errors.push(`duplicate question: "${q.text}"`);
    seen.add(key);
  }
  return errors;
};

// Content failures loop back to the drafter; once those retries are spent the
// fallback model gets exactly one pass, and a failure after that bubbles up.
export const validatorNode = async (state) => {
  const errors = validateContent(state);
  if (errors.length === 0) {
    return new Command({ update: { validationErrors: [] }, goto: "humanApproval" });
  }
  if (state.retryCount < MAX_CONTENT_RETRIES) {
    return new Command({
      update: { validationErrors: errors, retryCount: state.retryCount + 1 },
      goto: "drafter",
    });
  }
  if (!state.useFallbackModel) {
    return new Command({ update: { validationErrors: errors }, goto: "fallback" });
  }
  throw new AIInvalidResponseError(`Validation failed after fallback: ${errors.join("; ")}`);
};

export const fallbackNode = async (state) => ({
  useFallbackModel: true,
  retryCount: state.retryCount + 1,
});

// On resume LangGraph re-runs this node from the top, so nothing with side
// effects may sit before interrupt().
export const humanApprovalNode = async (state) => {
  const decision = interrupt({ draftQuestions: state.draftQuestions, plan: state.plan });
  return new Command({
    update: { approval: decision },
    goto: decision.approved ? "finalize" : END,
  });
};

export const makeFinalizeNode = ({ prisma }) => async (state) => {
  const finalQuestions = state.approval?.questions ?? state.draftQuestions;
  await prisma.interview.update({
    where: { id: state.interviewId },
    data: { questions: finalQuestions },
  });
  return {};
};
