import { describe, it, expect } from "vitest";
import { sanitizeAskedQuestion, setCurrentQuestion, getCurrentQuestion, clearCurrentQuestion } from "./roomQuestions.js";

const good = { index: 1, text: "Rank players by score", category: "technical", difficulty: "medium" };

describe("sanitizeAskedQuestion", () => {
  it("keeps only index, text, category and difficulty — never the LeetCode source", () => {
    const clean = sanitizeAskedQuestion({ ...good, source: { url: "https://leetcode.com/problems/rank-scores/" }, extra: 1 });
    expect(clean).toEqual(good);
  });

  it.each([
    ["a negative index", { ...good, index: -1 }],
    ["a fractional index", { ...good, index: 1.5 }],
    ["empty text", { ...good, text: "   " }],
    ["non-string text", { ...good, text: 42 }],
    ["an unknown category", { ...good, category: "trivia" }],
    ["an unknown difficulty", { ...good, difficulty: "extreme" }],
    ["null", null],
  ])("rejects %s", (_label, raw) => {
    expect(sanitizeAskedQuestion(raw)).toBeNull();
  });

  it("caps very long text at 2000 characters", () => {
    expect(sanitizeAskedQuestion({ ...good, text: "x".repeat(5000) }).text).toHaveLength(2000);
  });
});

describe("current question store", () => {
  it("sets, gets and clears per room", () => {
    const map = new Map();
    expect(getCurrentQuestion(map, "room-1")).toBeUndefined();
    setCurrentQuestion(map, "room-1", good);
    expect(getCurrentQuestion(map, "room-1")).toEqual(good);
    expect(getCurrentQuestion(map, "room-2")).toBeUndefined();
    clearCurrentQuestion(map, "room-1");
    expect(getCurrentQuestion(map, "room-1")).toBeUndefined();
  });
});
