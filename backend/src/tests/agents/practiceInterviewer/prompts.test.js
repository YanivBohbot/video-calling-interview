import { describe, it, expect } from "vitest";
import { buildInterviewerPrompt } from "../../../agents/practiceInterviewer/prompts.js";

const BASE = { role: "Backend engineer", interviewType: "technical" };

describe("interviewer prompt", () => {
  it("with the interview's question: asks it, never finds another one or names a source", () => {
    const prompt = buildInterviewerPrompt({ ...BASE, question: { text: "Merge two sorted lists", category: "technical", difficulty: "easy" } });
    expect(prompt).toContain("Merge two sorted lists");
    expect(prompt).toMatch(/do not call find_problem/i);
    expect(prompt).toMatch(/moved on to a new question/i);
  });

  it("without one: finds a problem on LeetCode, as before", () => {
    const prompt = buildInterviewerPrompt({ ...BASE, question: null });
    expect(prompt).toMatch(/call find_problem once/i);
    expect(prompt).not.toMatch(/do not call find_problem/i);
  });
});
