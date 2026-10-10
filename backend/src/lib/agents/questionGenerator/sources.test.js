import { describe, it, expect } from "vitest";
import { ToolMessage, AIMessage } from "@langchain/core/messages";
import { leetcodeUrl, collectSeenProblems, pickResearchProblems, attachSources } from "./sources.js";
import { QuestionSchema } from "./state.js";

const searchResult = (questions) =>
  new ToolMessage({
    content: JSON.stringify({ problems: { total: questions.length, questions } }),
    tool_call_id: "call-1",
    name: "search_problems",
  });

const A = { title: "Second Highest Salary", titleSlug: "second-highest-salary", difficulty: "Medium" };
const B = { title: "Rank Scores", titleSlug: "rank-scores", difficulty: "Medium" };

describe("leetcodeUrl", () => {
  it("builds the canonical problem URL from a slug", () => {
    expect(leetcodeUrl("two-sum")).toBe("https://leetcode.com/problems/two-sum/");
  });
});

describe("collectSeenProblems", () => {
  it("collects problems from tool messages only, ignoring the model's own text", () => {
    const seen = collectSeenProblems([
      new AIMessage(JSON.stringify({ titleSlug: "made-up", title: "Made Up", difficulty: "Easy" })),
      searchResult([A, B]),
    ]);
    expect([...seen.keys()]).toEqual(["second-highest-salary", "rank-scores"]);
    expect(seen.get("rank-scores")).toEqual({ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" });
  });

  it("ignores tool output that isn't JSON", () => {
    const seen = collectSeenProblems([new ToolMessage({ content: "rate limited", tool_call_id: "x", name: "search_problems" })]);
    expect(seen.size).toBe(0);
  });
});

describe("pickResearchProblems", () => {
  const seen = collectSeenProblems([searchResult([A, B])]);

  it("drops slugs no tool returned, de-duplicates, and caps at max", () => {
    const picked = pickResearchProblems(
      [{ slug: "ghost-problem" }, { slug: "rank-scores" }, { slug: "rank-scores" }, { slug: "second-highest-salary" }],
      seen,
      1,
    );
    expect(picked).toEqual([{ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" }]);
  });

  it("tolerates a missing problem list", () => {
    expect(pickResearchProblems(undefined, seen, 3)).toEqual([]);
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

  it("leaves questions without a sourceSlug unchanged", () => {
    const q = { text: "Plain", category: "technical", difficulty: "easy" };
    expect(attachSources([q], research)).toEqual([q]);
  });
});
