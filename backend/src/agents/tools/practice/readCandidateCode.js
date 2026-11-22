import { tool } from "langchain";
import { z } from "zod";

// read_candidate_code: the code in the candidate's editor, sent with their current
// message. It comes from the runtime context (per call), so it is never checkpointed.
export const createReadCandidateCodeTool = () =>
  tool(
    async (_args, runtime) => {
      const { code = "", language = "unknown" } = runtime?.context ?? {};
      return `Language: ${language}\n\n${code.trim() ? code : "(the editor is empty)"}`;
    },
    {
      name: "read_candidate_code",
      description:
        "Read the code currently in the candidate's editor. Use it before commenting on their code or giving a hint.",
      schema: z.object({}).describe("No arguments"),
    },
  );
