import { describe, it, expect } from "vitest";
import { createEndSessionTool } from "../../../ai/tools/endSession.js";
import { END_SESSION_TOOL } from "../../../ai/tools/index.js";

describe("end_session tool", () => {
  it("only acknowledges: the service ends the session after the turn", async () => {
    const endTool = createEndSessionTool();
    expect(endTool.name).toBe(END_SESSION_TOOL);
    expect(await endTool.invoke({ reason: "solved" })).toBe("Session ended. Say a short goodbye.");
  });

  it("refuses an unknown reason", async () => {
    await expect(createEndSessionTool().invoke({ reason: "bored" })).rejects.toThrow();
  });
});
