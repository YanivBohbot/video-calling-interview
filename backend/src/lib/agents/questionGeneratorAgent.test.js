import { describe, it, expect, vi, beforeEach } from "vitest";

const validQuestions = [
  { text: "Explain how you'd design a rate limiter.", category: "system-design", difficulty: "medium" },
  { text: "Tell me about a time you disagreed with a teammate.", category: "behavioral", difficulty: "easy" },
];

const makeMockAgent = (structuredResponse) => ({
  invoke: vi.fn().mockResolvedValue({ structuredResponse }),
});

describe("generateInterviewQuestions", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.AI_MODEL = "gpt-4o-mini";
  });

  it("returns the validated questions array on a valid response", async () => {
    const agent = makeMockAgent({ questions: validQuestions });
    const { generateInterviewQuestions } = await import("./questionGeneratorAgent.js");

    const result = await generateInterviewQuestions(
      { role: "Senior Backend Engineer", interviewType: "technical", count: 2 },
      { agent },
    );

    expect(result).toEqual(validQuestions);
    expect(agent.invoke).toHaveBeenCalledOnce();
    const [messagesArg, configArg] = agent.invoke.mock.calls[0];
    expect(messagesArg.messages[0].content).toContain("Senior Backend Engineer");
    expect(configArg).toEqual({ recursionLimit: 10 });
  });

  it("throws AIInvalidResponseError when the questions array is empty", async () => {
    const agent = makeMockAgent({ questions: [] });
    const { generateInterviewQuestions, AIInvalidResponseError } = await import(
      "./questionGeneratorAgent.js"
    );

    await expect(
      generateInterviewQuestions({ role: "x", interviewType: "technical", count: 1 }, { agent }),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });

  it("throws AIInvalidResponseError when a question is missing text", async () => {
    const agent = makeMockAgent({ questions: [{ text: "", category: "technical", difficulty: "easy" }] });
    const { generateInterviewQuestions, AIInvalidResponseError } = await import(
      "./questionGeneratorAgent.js"
    );

    await expect(
      generateInterviewQuestions({ role: "x", interviewType: "technical", count: 1 }, { agent }),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });

  it("throws AIProviderError when agent.invoke rejects", async () => {
    const agent = { invoke: vi.fn().mockRejectedValue(new Error("boom")) };
    const { generateInterviewQuestions, AIProviderError } = await import("./questionGeneratorAgent.js");

    await expect(
      generateInterviewQuestions({ role: "x", interviewType: "technical", count: 1 }, { agent }),
    ).rejects.toBeInstanceOf(AIProviderError);
  });

  it("throws AIConfigError when OPENAI_API_KEY is missing and no agent override is given", async () => {
    delete process.env.OPENAI_API_KEY;
    const { generateInterviewQuestions, AIConfigError } = await import("./questionGeneratorAgent.js");

    await expect(
      generateInterviewQuestions({ role: "x", interviewType: "technical", count: 1 }),
    ).rejects.toBeInstanceOf(AIConfigError);
  });
});
