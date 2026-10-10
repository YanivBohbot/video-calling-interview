import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/db.js", () => ({ prisma: {} }));

import { validateQuestionsPayload } from "./controller.js";

const base = { text: "Rank players", category: "technical", difficulty: "medium" };
const goodSource = {
  type: "leetcode",
  title: "Rank Scores",
  slug: "rank-scores",
  difficulty: "Medium",
  url: "https://leetcode.com/problems/rank-scores/",
};

describe("validateQuestionsPayload source", () => {
  it("accepts a question without a source (older saved questions)", () => {
    expect(validateQuestionsPayload([base])).toBeNull();
  });

  it("accepts a well-formed LeetCode source", () => {
    expect(validateQuestionsPayload([{ ...base, source: goodSource }])).toBeNull();
  });

  it.each([
    ["a non-LeetCode URL", { ...goodSource, url: "https://evil.example.com/rank-scores/" }],
    ["a javascript: URL", { ...goodSource, url: "javascript:alert(1)" }],
    ["a URL that doesn't match the slug", { ...goodSource, url: "https://leetcode.com/problems/two-sum/" }],
    ["a wrong type", { ...goodSource, type: "hackerrank" }],
    ["an empty title", { ...goodSource, title: "  " }],
    ["a slug with unsafe characters", { ...goodSource, slug: "../x", url: "https://leetcode.com/problems/../x/" }],
    ["null", null],
  ])("rejects %s", (_label, source) => {
    expect(validateQuestionsPayload([{ ...base, source }])).toBe("invalid question source");
  });
});
