import { describe, it, expect, vi } from "vitest";
import { ToolMessage, HumanMessage } from "langchain";
import { forceToolFirst } from "../../../ai/middleware/index.js";

const FORCED = { type: "function", function: { name: "present_question" } };
const call = (messages, { context = { mode: "avatar" }, when } = {}) => {
  const handler = vi.fn(async (request) => request);
  const middleware = forceToolFirst({ tool: "present_question", ...(when ? { when } : {}) });
  return middleware
    .wrapModelCall({ state: { messages }, runtime: { context } }, handler)
    .then(() => handler.mock.calls[0][0]);
};

describe("forceToolFirst", () => {
  it("forces the tool while it has never run in the thread", async () => {
    expect((await call([new HumanMessage("(The candidate has joined.)")])).toolChoice).toEqual(FORCED);
  });

  it("leaves the model free once the tool has run", async () => {
    const ran = new ToolMessage({ content: "ok", tool_call_id: "c1", name: "present_question" });
    expect((await call([new HumanMessage("x"), ran])).toolChoice).toBeUndefined();
  });

  it("does not count other tools", async () => {
    const other = new ToolMessage({ content: "code", tool_call_id: "c1", name: "read_candidate_code" });
    expect((await call([other])).toolChoice).toEqual(FORCED);
  });

  it("does nothing when `when` says no", async () => {
    const when = (request) => request.runtime.context.mode === "avatar";
    expect((await call([new HumanMessage("x")], { context: { mode: "text" }, when })).toolChoice).toBeUndefined();
  });
});
