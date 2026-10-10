import { describe, it, expect } from "vitest";
import { leetcodeUrl, parseSearchProblems, attachSources } from "./sources.js";
import { QuestionSchema } from "./state.js";

describe("leetcodeUrl", () => {
  it("builds the canonical problem URL from a slug", () => {
    expect(leetcodeUrl("two-sum")).toBe("https://leetcode.com/problems/two-sum/");
  });
});

describe("parseSearchProblems", () => {
  const raw = {
    filters: { tags: ["database"] },
    problems: {
      total: 2,
      questions: [
        { title: "Second Highest Salary", titleSlug: "second-highest-salary", difficulty: "Medium", acRate: 48.6 },
        { title: "Rank Scores", titleSlug: "rank-scores", difficulty: "Medium" },
      ],
    },
  };
  const expected = [
    { slug: "second-highest-salary", title: "Second Highest Salary", difficulty: "Medium" },
    { slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" },
  ];

  it("maps the search tool's JSON string output to problems", () => {
    expect(parseSearchProblems(JSON.stringify(raw))).toEqual(expected);
  });

  it("accepts an already-parsed object too", () => {
    expect(parseSearchProblems(raw)).toEqual(expected);
  });

  it("returns [] for empty, non-JSON, or malformed output", () => {
    expect(parseSearchProblems(JSON.stringify({ problems: { total: 0, questions: [] } }))).toEqual([]);
    expect(parseSearchProblems("rate limited")).toEqual([]);
    expect(parseSearchProblems({ problems: { questions: [{ title: "No slug" }] } })).toEqual([]);
  });
});

describe("attachSources", () => {
  const research = [{ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" }];

  it("turns a known slug on a technical question into a full source with a built URL", () => {
    const [q] = attachSources([{ text: "Rank players", category: "technical", difficulty: "medium", sourceSlug: "rank-scores" }], research);
    expect(q).toEqual({
      text: "Rank players",
      category: "technical",
      difficulty: "medium",
      source: { type: "leetcode", title: "Rank Scores", slug: "rank-scores", difficulty: "Medium", url: "https://leetcode.com/problems/rank-scores/" },
    });
    expect(QuestionSchema.parse(q)).toEqual(q);
  });

  it("drops a slug that isn't in the research list", () => {
    const [q] = attachSources([{ text: "T", category: "technical", difficulty: "easy", sourceSlug: "invented-slug" }], research);
    expect(q).toEqual({ text: "T", category: "technical", difficulty: "easy" });
  });

  it("never attaches a source to a behavioral or system-design question", () => {
    const out = attachSources(
      [
        { text: "B", category: "behavioral", difficulty: "easy", sourceSlug: "rank-scores" },
        { text: "S", category: "system-design", difficulty: "hard", sourceSlug: "rank-scores" },
      ],
      research,
    );
    expect(out.every((q) => q.source === undefined)).toBe(true);
  });

  it("keeps a problem's source only on the first question that uses it", () => {
    const out = attachSources(
      [
        { text: "First", category: "technical", difficulty: "medium", sourceSlug: "rank-scores" },
        { text: "Second", category: "technical", difficulty: "medium", sourceSlug: "rank-scores" },
      ],
      research,
    );
    expect(out[0].source?.slug).toBe("rank-scores");
    expect(out[1]).toEqual({ text: "Second", category: "technical", difficulty: "medium" });
  });

  it("leaves questions without a sourceSlug unchanged", () => {
    const q = { text: "Plain", category: "technical", difficulty: "easy" };
    expect(attachSources([q], research)).toEqual([q]);
  });
});
