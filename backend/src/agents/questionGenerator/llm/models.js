import { initChatModel } from "langchain";
import { buildDrafterPrompt, buildResearcherPrompt } from "./prompts.js";
import { DraftResponseSchema, SearchQuerySchema } from "../graph/state.js";
import { AIConfigError } from "../errors.js";

// The pipeline's two LLM calls. Neither uses tools, so each is a single typed call:
// `model.withStructuredOutput(zodSchema)` (the LangChain pattern for structured output
// without an agent loop), validated by zod.
//
// Model names are full "provider:model" strings (e.g. "openai:gpt-4o-mini"), so the
// provider is configuration, not code. Each model is initialised once, on first use.
const MAX_SEARCH_TAGS = 3;

// The schemas are written for OpenAI's strict native structured output (every property
// present, nullable rather than optional); other providers choose their own method.
const structuredOptions = (modelName, name) =>
  modelName.startsWith("openai:") ? { name, method: "jsonSchema", strict: true } : { name };

export const createQuestionModels = ({ model, fallbackModel, initModel = initChatModel }) => {
  const cache = new Map();
  const structured = (modelName, schema, name) => {
    const key = `${modelName}|${name}`;
    if (!cache.has(key)) {
      const pending = Promise.resolve()
        .then(() => initModel(modelName))
        .then((chatModel) => chatModel.withStructuredOutput(schema, structuredOptions(modelName, name)))
        .catch((err) => {
          cache.delete(key); // a fixed config can be retried without a restart
          throw new AIConfigError(`Could not initialise AI model "${modelName}": ${err.message}`);
        });
      cache.set(key, pending);
    }
    return cache.get(key);
  };

  const ask = async (modelName, schema, name, systemPrompt, userContent) => {
    const runnable = await structured(modelName, schema, name);
    return runnable.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ]);
  };

  // Researcher: the model only picks LeetCode search filters; code runs the search.
  const chooseSearch = async ({ role, interviewType }) => {
    const { category, tags, difficulty } = await ask(
      model,
      SearchQuerySchema,
      "search_query",
      buildResearcherPrompt(),
      `Role: ${role}\nInterview type: ${interviewType}`,
    );
    return { category, tags: tags.slice(0, MAX_SEARCH_TAGS), difficulty };
  };

  // Drafter: returns { questions } (each with a nullable sourceSlug).
  const draft = ({ useFallbackModel = false, prompt }) =>
    ask(useFallbackModel ? fallbackModel : model, DraftResponseSchema, "draft_questions", buildDrafterPrompt(), prompt);

  return { chooseSearch, draft };
};
