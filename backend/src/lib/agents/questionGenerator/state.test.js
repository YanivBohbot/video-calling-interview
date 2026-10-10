import { describe, it, expect } from "vitest";
import { StateGraph, START, END } from "@langchain/langgraph";
import { QuestionSchema, DraftResponseSchema, ResearchResponseSchema, QuestionGenState } from "./state.js";

describe("question generator schemas", () => {
  it("accepts a valid question", () => {
    const q = { text: "Explain closures", category: "technical", difficulty: "medium" };
    expect(QuestionSchema.parse(q)).toEqual(q);
  });

  it("rejects an invalid category", () => {
    expect(() =>
      QuestionSchema.parse({ text: "x", category: "nope", difficulty: "easy" }),
    ).toThrow();
  });

  it("DraftResponseSchema requires a questions array", () => {
    expect(() => DraftResponseSchema.parse({ questions: "not an array" })).toThrow();
    expect(
      DraftResponseSchema.parse({ questions: [{ text: "x", category: "technical", difficulty: "easy" }] }),
    ).toEqual({ questions: [{ text: "x", category: "technical", difficulty: "easy" }] });
  });

  it("ResearchResponseSchema requires usedLeetCode and notes", () => {
    expect(ResearchResponseSchema.parse({ usedLeetCode: true, notes: "n" })).toEqual({
      usedLeetCode: true,
      notes: "n",
    });
    expect(() => ResearchResponseSchema.parse({ usedLeetCode: true })).toThrow();
  });

  it("QuestionGenState fields default correctly when run through a graph", async () => {
    const graph = new StateGraph(QuestionGenState)
      .addNode("noop", async () => ({}))
      .addEdge(START, "noop")
      .addEdge("noop", END)
      .compile();
    const result = await graph.invoke({ interviewId: "i1", role: "r", interviewType: "technical", count: 3 });
    expect(result).toEqual({
      interviewId: "i1",
      role: "r",
      interviewType: "technical",
      count: 3,
      plan: null,
      research: [],
      draftQuestions: [],
      validationErrors: [],
      retryCount: 0,
      useFallbackModel: false,
      approval: null,
    });
  });
});
