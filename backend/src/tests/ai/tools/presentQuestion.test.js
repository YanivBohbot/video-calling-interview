import { describe, it, expect } from "vitest";
import { createPresentQuestionTool } from "../../../ai/tools/presentQuestion.js";
import { PRESENT_QUESTION_TOOL } from "../../../ai/tools/index.js";

const QUESTIONS = [
  { text: "Tell me about a conflict in your team", category: "behavioral", difficulty: "easy" },
  { text: "Reverse a linked list", category: "technical", difficulty: "medium" },
];
const avatar = { context: { mode: "avatar", questions: QUESTIONS } };

describe("present_question tool", () => {
  it("returns the question at that index, as JSON", async () => {
    const presentTool = createPresentQuestionTool();
    expect(presentTool.name).toBe(PRESENT_QUESTION_TOOL);
    expect(JSON.parse(await presentTool.invoke({ index: 1 }, avatar))).toEqual({ index: 1, text: "Reverse a linked list" });
  });

  it("says so when there is no question at that index", async () => {
    expect(await createPresentQuestionTool().invoke({ index: 2 }, avatar)).toBe("No question at that index");
  });

  it("is not available outside an avatar session", async () => {
    const text = { context: { mode: "text", questions: QUESTIONS } };
    expect(await createPresentQuestionTool().invoke({ index: 0 }, text)).toBe("Not available in this session");
    expect(await createPresentQuestionTool().invoke({ index: 0 }, {})).toBe("Not available in this session");
  });

  it("refuses a negative or fractional index", async () => {
    await expect(createPresentQuestionTool().invoke({ index: -1 }, avatar)).rejects.toThrow();
    await expect(createPresentQuestionTool().invoke({ index: 0.5 }, avatar)).rejects.toThrow();
  });
});
