import { describe, it, expect, vi } from "vitest";
import { createSearchProblems } from "./search.js";

const RAW = JSON.stringify({ problems: { questions: [{ titleSlug: "two-sum", title: "Two Sum", difficulty: "Easy" }] } });

describe("LeetCode search", () => {
  it("calls search_problems and parses its JSON", async () => {
    const invoke = vi.fn().mockResolvedValue(RAW);
    const search = createSearchProblems({ getTools: async () => [{ name: "search_problems", invoke }] });
    expect(await search({ category: "algorithms", tags: ["array"], difficulty: "EASY", limit: 3, offset: 0 })).toEqual([
      { slug: "two-sum", title: "Two Sum", difficulty: "Easy" },
    ]);
    expect(invoke).toHaveBeenCalledWith({ category: "algorithms", tags: ["array"], difficulty: "EASY", limit: 3, offset: 0 });
  });

  it("omits empty tags (the tool rejects an empty list)", async () => {
    const invoke = vi.fn().mockResolvedValue(RAW);
    const search = createSearchProblems({ getTools: async () => [{ name: "search_problems", invoke }] });
    await search({ category: "algorithms", tags: [], limit: 3 });
    expect(invoke).toHaveBeenCalledWith({ category: "algorithms", limit: 3 });
  });

  it("throws when the tool is unavailable (the researcher degrades to no grounding)", async () => {
    const search = createSearchProblems({ getTools: async () => [] });
    await expect(search({ category: "algorithms" })).rejects.toThrow(/search_problems/);
  });
});
