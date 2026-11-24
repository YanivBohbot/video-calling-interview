import { tool } from "langchain";
import { z } from "zod";

export const END_SESSION_TOOL = "end_session";

// end_session: the agent decides the session is over. The tool only acknowledges; the
// practice service sees the call after the turn, closes the session and starts the report.
export const createEndSessionTool = () =>
  tool(async () => "Session ended. Say a short goodbye.", {
    name: END_SESSION_TOOL,
    description:
      "End the AI interview. Use it when the candidate has solved the problem and discussed it, " +
      "gives up, or asks to stop.",
    schema: z.object({
      reason: z.enum(["solved", "gave_up", "out_of_time"]).describe("Why the session ends"),
    }),
  });
