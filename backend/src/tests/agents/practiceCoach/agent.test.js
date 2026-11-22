import { describe, it, expect, vi } from "vitest";
import { fakeModel, AIMessage } from "langchain";
import { createPracticeCoach, reportFormat, CoachFailedError } from "../../../agents/practiceCoach/index.js";

const REPORT_TOOL = reportFormat[0].name;
const LANGUAGES = ["python"];
const SESSION = {
  transcript: [
    { role: "interviewer", text: "Write two_sum." },
    { role: "candidate", text: "Done." },
  ],
  code: "def two_sum(a, t): ...",
  language: "python",
};
const report = (testsRun) => ({
  summary: "Good start.",
  strengths: ["Clear names"],
  improvements: ["Handle empty input"],
  testsRun,
  complexity: { time: "O(n^2)", space: "O(1)", comment: "Can be O(n) with a hash map." },
  nextSteps: ["Practice hash maps"],
});
const test = (runId, actual) => ({ runId, input: "[2,7],9", expected: "[0,1]", actual, passed: true });

describe("practice coach agent", () => {
  it("keeps only tests that really ran, with their real output", async () => {
    const runCode = vi
      .fn()
      .mockResolvedValueOnce({ output: "[0, 1]\n", exitCode: 0, timedOut: false })
      .mockResolvedValueOnce({ output: "IndexError\n", exitCode: 1, timedOut: false });
    const model = fakeModel()
      .respondWithTools([{ name: "run_code", args: { language: "python", code: "print(two_sum([2,7],9))" } }])
      .respondWithTools([{ name: "run_code", args: { language: "python", code: "print(two_sum([],1))" } }])
      .respondWithTools([{ name: REPORT_TOOL, args: report([test("run-1", "made up"), test("run-2", "[]"), test("run-9", "[0,1]")]) }]);
    const coach = createPracticeCoach({ model, runCode, languages: LANGUAGES });
    const result = await coach.review(SESSION);
    expect(result.testsRun.map((t) => t.runId)).toEqual(["run-1", "run-2"]);
    expect(result.testsRun.map((t) => t.actual)).toEqual(["[0, 1]\n", "IndexError\n"]);
    expect(result.summary).toBe("Good start.");
  });

  it("lets one run back one test only (no five tests citing the same run)", async () => {
    const runCode = vi.fn().mockResolvedValue({ output: "[0, 1]\n", exitCode: 0, timedOut: false });
    const model = fakeModel()
      .respondWithTools([{ name: "run_code", args: { language: "python", code: "print(1)" } }])
      .respondWithTools([{ name: REPORT_TOOL, args: report([test("run-1", "a"), test("run-1", "b")]) }]);
    const result = await createPracticeCoach({ model, runCode, languages: LANGUAGES }).review(SESSION);
    expect(result.testsRun).toHaveLength(1);
  });

  it("gets a valid report after an invalid structured answer", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "run_code", args: { language: "python", code: "print(1)" } }])
      .respondWithTools([{ name: REPORT_TOOL, args: { summary: 42 } }])
      .respondWithTools([{ name: REPORT_TOOL, args: report([]) }]);
    const runCode = vi.fn().mockResolvedValue({ output: "1\n", exitCode: 0, timedOut: false });
    const result = await createPracticeCoach({ model, runCode, languages: LANGUAGES }).review(SESSION);
    expect(result.complexity.time).toBe("O(n^2)");
    expect(model.callCount).toBe(3);
  });

  it("throws CoachFailedError when no report comes out", async () => {
    const model = fakeModel().respond(new AIMessage("I cannot."));
    await expect(createPracticeCoach({ model, runCode: vi.fn(), languages: LANGUAGES }).review(SESSION)).rejects.toBeInstanceOf(
      CoachFailedError,
    );
  });

  it("does not accept a report written before any code ran", async () => {
    const model = fakeModel().respondWithTools([{ name: REPORT_TOOL, args: report([]) }]).respond(new AIMessage("Done."));
    await expect(createPracticeCoach({ model, runCode: vi.fn(), languages: LANGUAGES }).review(SESSION)).rejects.toBeInstanceOf(
      CoachFailedError,
    );
  });

  it("sends the transcript and the final code to the model", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "run_code", args: { language: "python", code: "print(1)" } }])
      .respondWithTools([{ name: REPORT_TOOL, args: report([]) }]);
    const runCode = vi.fn().mockResolvedValue({ output: "1\n", exitCode: 0, timedOut: false });
    await createPracticeCoach({ model, runCode, languages: LANGUAGES }).review(SESSION);
    const sent = JSON.stringify(model.calls[0].messages);
    expect(sent).toContain("Write two_sum.");
    expect(sent).toContain("def two_sum(a, t): ...");
  });
});
