import { describe, it, expect, vi } from "vitest";
import { ToolMessage, HumanMessage } from "langchain";
import { requireToolBeforeResponse } from "../../../ai/middleware/index.js";

const FORMAT = [{ name: "extract-1" }];
const call = (messages) => {
  const handler = vi.fn(async (request) => request);
  const middleware = requireToolBeforeResponse({ tool: "run_code" });
  return middleware.wrapModelCall({ responseFormat: FORMAT, state: { messages } }, handler).then(() => handler.mock.calls[0][0]);
};

describe("requireToolBeforeResponse", () => {
  it("hides the structured response until the tool has run once", async () => {
    expect((await call([new HumanMessage("review this")])).responseFormat).toEqual([]);
  });

  it("offers the structured response once the tool has run", async () => {
    const ran = new ToolMessage({ content: "{}", tool_call_id: "c1", name: "run_code" });
    expect((await call([new HumanMessage("x"), ran])).responseFormat).toBe(FORMAT);
  });

  it("does not count other tools", async () => {
    const other = new ToolMessage({ content: "code", tool_call_id: "c1", name: "read_candidate_code" });
    expect((await call([other])).responseFormat).toEqual([]);
  });
});
