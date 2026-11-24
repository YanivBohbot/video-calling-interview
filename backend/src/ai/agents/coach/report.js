import { toolStrategy } from "langchain";
import { z } from "zod";

// The report the interviewer reads at the end of the candidate's AI session. Not a grade.
// Field names are stored with every report: change descriptions, not names.
export const PracticeReportSchema = z.object({
  summary: z.string().describe("Two or three sentences on how the session went, hints needed included"),
  strengths: z.array(z.string()).describe("What the candidate did well"),
  improvements: z.array(z.string()).describe("Weaknesses observed, concretely"),
  testsRun: z
    .array(
      z.object({
        runId: z.string().describe("The runId returned by run_code for this test"),
        input: z.string().describe("The input tried"),
        expected: z.string().describe("The correct output"),
        actual: z.string().describe("What the candidate's code printed"),
        passed: z.boolean().describe("Whether actual matches expected"),
      }),
    )
    .describe("Only tests you actually ran with run_code"),
  complexity: z.object({
    time: z.string().describe("Time complexity of the final code, Big-O notation only (e.g. O(n log n)); explain in comment"),
    space: z.string().describe("Space complexity of the final code, Big-O notation only (e.g. O(n)); explain in comment"),
    comment: z.string().describe("What n and the other variables are, whether it can be improved, and how"),
  }),
  nextSteps: z.array(z.string()).describe("Topics the interviewer could probe in a follow-up"),
});

// Built once: toolStrategy names its tool from a module-wide counter ("extract-N"), so tests
// read the name from here (reportFormat[0].name) instead of hard-coding it.
export const reportFormat = toolStrategy(PracticeReportSchema);
