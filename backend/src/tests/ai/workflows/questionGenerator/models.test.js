import { describe, it, expect, vi } from "vitest";
import { createQuestionModels } from "../../../../ai/workflows/questionGenerator/models.js";
import { AIConfigError } from "../../../../ai/workflows/questionGenerator/errors.js";

// A fake initChatModel: records which model string was built and what each structured
// call received, and answers with the given payload.
const fakeInit = (answer) => {
  const calls = [];
  const initModel = vi.fn(async (name) => ({
    withStructuredOutput: (schema, options) => ({
      invoke: async (messages) => {
        calls.push({ name, options, messages });
        return typeof answer === "function" ? answer(name) : answer;
      },
    }),
  }));
  return { initModel, calls };
};

describe("question models", () => {
  it("chooseSearch sends the researcher prompt + role and keeps at most 3 tags", async () => {
    const { initModel, calls } = fakeInit({ category: "algorithms", tags: ["array", "string", "math", "tree"], difficulty: "MEDIUM" });
    const models = createQuestionModels({ model: "openai:gpt-4o-mini", fallbackModel: "openai:gpt-4o", initModel });
    const query = await models.chooseSearch({ role: "Backend Engineer", interviewType: "technical" });
    expect(query).toEqual({ category: "algorithms", tags: ["array", "string", "math"], difficulty: "MEDIUM" });
    expect(calls[0].messages[0].role).toBe("system");
    expect(calls[0].messages[1]).toEqual({ role: "user", content: "Role: Backend Engineer\nInterview type: technical" });
  });

  it("draft uses the primary model, or the fallback when asked", async () => {
    const { initModel, calls } = fakeInit((name) => ({ questions: [{ text: name }] }));
    const models = createQuestionModels({ model: "openai:gpt-4o-mini", fallbackModel: "openai:gpt-4o", initModel });
    expect(await models.draft({ useFallbackModel: false, prompt: "p" })).toEqual({ questions: [{ text: "openai:gpt-4o-mini" }] });
    expect(await models.draft({ useFallbackModel: true, prompt: "p" })).toEqual({ questions: [{ text: "openai:gpt-4o" }] });
    expect(calls[1].messages[1]).toEqual({ role: "user", content: "p" });
  });

  it("builds each model once, however many calls", async () => {
    const { initModel } = fakeInit({ questions: [] });
    const models = createQuestionModels({ model: "openai:gpt-4o-mini", fallbackModel: "openai:gpt-4o", initModel });
    await models.draft({ useFallbackModel: false, prompt: "a" });
    await models.draft({ useFallbackModel: false, prompt: "b" });
    expect(initModel).toHaveBeenCalledTimes(1);
  });

  it("asks OpenAI for strict native JSON-schema output (the schemas are written for it)", async () => {
    const { initModel, calls } = fakeInit({ questions: [] });
    await createQuestionModels({ model: "openai:gpt-4o-mini", fallbackModel: "openai:gpt-4o", initModel }).draft({ prompt: "p" });
    expect(calls[0].options).toMatchObject({ method: "jsonSchema", strict: true });
  });

  it("lets other providers pick their own structured-output method", async () => {
    const { initModel, calls } = fakeInit({ questions: [] });
    await createQuestionModels({ model: "anthropic:claude-sonnet-5", fallbackModel: "anthropic:claude-sonnet-5", initModel }).draft({ prompt: "p" });
    expect(calls[0].options).not.toHaveProperty("method");
  });

  it("turns a model that can't be initialised into an AIConfigError", async () => {
    const initModel = vi.fn().mockRejectedValue(new Error("Unable to infer model provider"));
    const models = createQuestionModels({ model: "nope:x", fallbackModel: "nope:y", initModel });
    await expect(models.draft({ prompt: "p" })).rejects.toBeInstanceOf(AIConfigError);
  });
});
