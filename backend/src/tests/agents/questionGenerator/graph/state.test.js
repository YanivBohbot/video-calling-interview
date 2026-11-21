import { describe, it, expect } from "vitest";
import { StateGraph, START, END } from "@langchain/langgraph";
import { QuestionSchema, DraftResponseSchema, SearchQuerySchema, QuestionGenState } from "../../../../agents/questionGenerator/graph/state.js";

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

  it("DraftResponseSchema requires sourceSlug (string or null) on every question", () => {
    const ok = { questions: [{ text: "x", category: "technical", difficulty: "easy", sourceSlug: null }] };
    expect(DraftResponseSchema.parse(ok)).toEqual(ok);
    expect(() => DraftResponseSchema.parse({ questions: [{ text: "x", category: "technical", difficulty: "easy" }] })).toThrow();
    expect(() => DraftResponseSchema.parse({ questions: "not an array" })).toThrow();
  });

  it("SearchQuerySchema only allows search filters the LeetCode tool accepts", () => {
    const q = { category: "database", tags: ["hash-table"], difficulty: "MEDIUM" };
    expect(SearchQuerySchema.parse(q)).toEqual(q);
    expect(() => SearchQuerySchema.parse({ ...q, category: "frontend" })).toThrow();
    expect(() => SearchQuerySchema.parse({ ...q, tags: ["kubernetes"] })).toThrow();
    expect(() => SearchQuerySchema.parse({ ...q, difficulty: "Medium" })).toThrow();
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
