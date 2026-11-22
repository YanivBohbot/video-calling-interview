import { describe, it, expect } from "vitest";
import { createReadCandidateCodeTool } from "../../../../agents/tools/practice/readCandidateCode.js";

describe("read_candidate_code tool", () => {
  it("returns the code sent with the current message (runtime context)", async () => {
    const readTool = createReadCandidateCodeTool();
    expect(readTool.name).toBe("read_candidate_code");
    expect(await readTool.invoke({}, { context: { code: "def f(): pass", language: "python" } })).toBe(
      "Language: python\n\ndef f(): pass",
    );
  });

  it("says so when the editor is empty", async () => {
    expect(await createReadCandidateCodeTool().invoke({}, { context: { code: "  ", language: "python" } })).toBe(
      "Language: python\n\n(the editor is empty)",
    );
  });
});
