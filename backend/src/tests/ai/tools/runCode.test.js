import { describe, it, expect, vi } from "vitest";
import { createRunCodeTool } from "../../../ai/tools/runCode.js";

const LANGUAGES = ["javascript", "python"];
const RESULT = { output: "3\n", stdout: "3\n", stderr: "", exitCode: 0, timedOut: false };

describe("run_code tool", () => {
  it("runs the code and numbers each run", async () => {
    const runCode = vi.fn().mockResolvedValue(RESULT);
    const onRun = vi.fn();
    const runTool = createRunCodeTool({ runCode, languages: LANGUAGES, onRun });
    expect(runTool.name).toBe("run_code");
    const first = JSON.parse(await runTool.invoke({ language: "python", code: "print(3)", stdin: "1" }));
    expect(runCode).toHaveBeenCalledWith({ language: "python", code: "print(3)", stdin: "1" });
    expect(first).toEqual({ runId: "run-1", output: "3\n", exitCode: 0, timedOut: false });
    const second = JSON.parse(await runTool.invoke({ language: "python", code: "print(3)" }));
    expect(second.runId).toBe("run-2");
    expect(runCode).toHaveBeenLastCalledWith({ language: "python", code: "print(3)", stdin: "" });
    expect(onRun).toHaveBeenLastCalledWith({
      runId: "run-2", language: "python", code: "print(3)", stdin: "", output: "3\n", exitCode: 0, timedOut: false,
    });
  });

  it("refuses a language the editor does not offer", async () => {
    const runTool = createRunCodeTool({ runCode: vi.fn(), languages: LANGUAGES });
    await expect(runTool.invoke({ language: "ruby", code: "puts 1" })).rejects.toThrow();
  });

  it("tells the model to carry on when the code runner is down", async () => {
    const runTool = createRunCodeTool({ runCode: vi.fn().mockRejectedValue(new Error("down")), languages: LANGUAGES });
    expect(await runTool.invoke({ language: "python", code: "" })).toBe(
      "The code runner is unavailable; continue without running code.",
    );
  });
});
