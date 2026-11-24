import { tool } from "langchain";
import { z } from "zod";

const UNAVAILABLE = "The code runner is unavailable; continue without running code.";

// run_code: executes code in the sandbox (Piston, injected as `runCode`) and returns what it
// printed. Each run gets an id ("run-1", "run-2"…) so a report can cite only real runs;
// `onRun` sees every run (the coach records them).
export const createRunCodeTool = ({ runCode, languages, onRun = () => {} }) => {
  let runs = 0;
  return tool(
    async ({ language, code, stdin }) => {
      let result;
      try {
        result = await runCode({ language, code, stdin });
      } catch {
        return UNAVAILABLE;
      }
      const runId = `run-${++runs}`;
      const { output, exitCode, timedOut } = result;
      onRun({ runId, language, code, stdin, output, exitCode, timedOut });
      return JSON.stringify({ runId, output, exitCode, timedOut });
    },
    {
      name: "run_code",
      description:
        "Run code in a sandbox and see its output. Use it to check whether the candidate's code works, " +
        "or to try an input (edge case, large input). Pass the full program, including the call that prints the result.",
      schema: z.object({
        language: z.enum(languages).describe("Language of the code"),
        code: z.string().max(50000).describe("Complete program to run"),
        stdin: z.string().max(10000).default("").describe("Standard input for the program, if it reads any"),
      }),
    },
  );
};
