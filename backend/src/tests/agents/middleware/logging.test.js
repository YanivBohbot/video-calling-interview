import { describe, it, expect, vi } from "vitest";
import { createAgent, tool, fakeModel, AIMessage } from "langchain";
import { z } from "zod";
import { createLoggingMiddleware } from "../../../agents/middleware/index.js";

describe("logging middleware", () => {
  it("logs model and tool calls with timings, never message content or tool arguments", async () => {
    const log = vi.fn();
    const runTool = tool(async () => "ok", { name: "run_code", description: "x", schema: z.object({ code: z.string() }) });
    const model = fakeModel().respondWithTools([{ name: "run_code", args: { code: "SECRET_CODE" } }]).respond(new AIMessage("done"));
    const agent = createAgent({ model, tools: [runTool], middleware: [createLoggingMiddleware({ agent: "test", log })] });
    await agent.invoke({ messages: [{ role: "user", content: "SECRET_MESSAGE" }] });
    expect(log).toHaveBeenCalledWith({ agent: "test", event: "model", ms: expect.any(Number), ok: true });
    expect(log).toHaveBeenCalledWith({ agent: "test", event: "tool", tool: "run_code", ms: expect.any(Number), ok: true });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("SECRET_CODE");
    expect(logged).not.toContain("SECRET_MESSAGE");
  });

  it("logs a failed call with ok: false and rethrows", async () => {
    const log = vi.fn();
    const model = fakeModel().alwaysThrow(new Error("boom"));
    const agent = createAgent({ model, tools: [], middleware: [createLoggingMiddleware({ agent: "test", log })] });
    await expect(agent.invoke({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow("boom");
    expect(log).toHaveBeenCalledWith({ agent: "test", event: "model", ms: expect.any(Number), ok: false });
  });
});
