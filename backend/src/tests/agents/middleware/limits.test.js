import { describe, it, expect } from "vitest";
import { createAgent, tool, fakeModel } from "langchain";
import { z } from "zod";
import { turnLimits, isLimitMessage, withFallback } from "../../../agents/middleware/index.js";

const runTool = tool(async () => "ok", { name: "run_code", description: "x", schema: z.object({}) });
const loopingModel = () => {
  const model = fakeModel();
  for (let i = 0; i < 5; i++) model.respondWithTools([{ name: "run_code", args: {} }]);
  return model;
};

describe("turnLimits", () => {
  it("stops a looping agent after the model-call limit and marks the last message", async () => {
    const model = loopingModel();
    const agent = createAgent({ model, tools: [runTool], middleware: turnLimits({ modelCalls: 2, toolCalls: 8 }) });
    const { messages } = await agent.invoke({ messages: [{ role: "user", content: "go" }] });
    expect(model.callCount).toBe(2);
    expect(isLimitMessage(messages.at(-1))).toBe(true);
    expect(isLimitMessage(messages[1])).toBe(false);
  });
});

describe("withFallback", () => {
  it("adds the fallback middleware only when a fallback model is configured", () => {
    expect(withFallback(undefined)).toEqual([]);
    expect(withFallback("openai:gpt-4o")).toHaveLength(1);
  });
});

describe("createCallBudget (wrap-style, safe with structured output)", () => {
  it("stops the run once the model-call budget is spent", async () => {
    const { createCallBudget } = await import("../../../agents/middleware/index.js");
    const model = loopingModel();
    const agent = createAgent({ model, tools: [runTool], middleware: [createCallBudget({ modelCalls: 2, toolCalls: 8 })] });
    await expect(agent.invoke({ messages: [{ role: "user", content: "go" }] })).rejects.toMatchObject({ name: "BudgetExceededError" });
    expect(model.callCount).toBe(2);
  });

  it("stops the run once the tool-call budget is spent", async () => {
    const { createCallBudget } = await import("../../../agents/middleware/index.js");
    let ran = 0;
    const counted = tool(async () => String(++ran), { name: "run_code", description: "x", schema: z.object({}) });
    const agent = createAgent({ model: loopingModel(), tools: [counted], middleware: [createCallBudget({ modelCalls: 8, toolCalls: 2 })] });
    await expect(agent.invoke({ messages: [{ role: "user", content: "go" }] })).rejects.toMatchObject({ name: "BudgetExceededError" });
    expect(ran).toBe(2);
  });
});
