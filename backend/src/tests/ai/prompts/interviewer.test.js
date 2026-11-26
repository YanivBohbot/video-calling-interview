import { describe, it, expect } from "vitest";
import { buildInterviewerPrompt, buildQuestionSwitchNote, buildAvatarInterviewerPrompt } from "../../../ai/prompts/interviewer.js";

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

describe("question switch note", () => {
  it("tells the agent to announce the new question, and gives it", () => {
    const note = buildQuestionSwitchNote({ text: "Design a food rating system", category: "technical", difficulty: "medium" });
    expect(note).toMatch(/moved on to a new question/);
    expect(note).toContain("Design a food rating system");
  });
});

describe("avatar interviewer prompt", () => {
  const AVATAR = {
    role: "Backend engineer",
    company: "Acme",
    interviewLanguage: "en",
    questions: [
      { text: "Tell me about a hard bug you fixed", category: "behavioral", difficulty: "easy" },
      { text: "Reverse a linked list", category: "technical", difficulty: "medium" },
      { text: "Design a URL shortener", category: "system-design", difficulty: "hard" },
    ],
  };

  it("greets with the role and company, says how many questions, and walks them with present_question", () => {
    const prompt = buildAvatarInterviewerPrompt(AVATAR);
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("Backend engineer");
    expect(prompt).toMatch(/\b3 questions\b/);
    expect(prompt).toContain("present_question");
    expect(prompt).toContain("(The candidate has joined.)");
    expect(prompt).toContain("Reverse a linked list");
    expect(prompt).toMatch(/end_session/);
    expect(prompt).not.toMatch(/Hebrew/);
  });

  it("speaks Hebrew when the interview language is he", () => {
    expect(buildAvatarInterviewerPrompt({ ...AVATAR, interviewLanguage: "he" })).toMatch(/Hebrew/);
  });

  it("text mode keeps its own prompt", () => {
    expect(buildInterviewerPrompt({ role: "Backend engineer", interviewType: "technical" })).not.toContain("present_question");
  });
});
