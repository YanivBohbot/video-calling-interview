import { attachSources } from "../../tools/leetcode/sources.js";

// LLM step: draft the questions (structured output). Dependency (runtime.context): draft (llm/models.js).

const formatResearch = (research) =>
  research.length ? research.map((p) => `- ${p.slug} — ${p.title} (${p.difficulty})`).join("\n") : "none";

export const drafterNode = async (state, runtime) => {
  const { draft } = runtime.context;
  const prompt = [
    `Generate exactly ${state.count} interview questions.`,
    `Role: ${state.role}`,
    `Interview type: ${state.interviewType}`,
    `Category mix: ${JSON.stringify(state.plan.categoryCounts)}`,
    `LeetCode problems you may use (one per technical question):\n${formatResearch(state.research)}`,
    ...(state.validationErrors?.length
      ? [`Your previous draft was rejected: ${state.validationErrors.join("; ")}. Fix these.`]
      : []),
  ].join("\n");
  const { questions } = await draft({ useFallbackModel: state.useFallbackModel, prompt });
  return { draftQuestions: attachSources(questions, state.research) };
};
