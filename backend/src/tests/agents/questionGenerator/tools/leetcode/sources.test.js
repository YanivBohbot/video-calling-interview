import { describe, it, expect } from "vitest";
import { leetcodeUrl, attachSources } from "../../../../../agents/questionGenerator/tools/leetcode/sources.js";
import { QuestionSchema } from "../../../../../agents/questionGenerator/graph/state.js";

describe("leetcodeUrl", () => {
  it("builds the canonical problem URL from a slug", () => {
    expect(leetcodeUrl("two-sum")).toBe("https://leetcode.com/problems/two-sum/");
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
