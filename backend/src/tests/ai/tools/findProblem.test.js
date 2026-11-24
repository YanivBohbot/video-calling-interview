import { describe, it, expect, vi } from "vitest";
import { createFindProblemTool } from "../../../ai/tools/findProblem.js";

const problems = Array.from({ length: 8 }, (_, i) => ({ slug: `p-${i}`, title: `Problem ${i}`, difficulty: "Medium", content: "secret" }));

describe("find_problem tool", () => {
  it("searches LeetCode and returns at most 5 problems with title, difficulty and link only", async () => {
    const searchProblems = vi.fn().mockResolvedValue(problems);
    const findTool = createFindProblemTool({ searchProblems, randomOffset: () => 7 });
    expect(findTool.name).toBe("find_problem");
    const found = JSON.parse(await findTool.invoke({ difficulty: "MEDIUM", tags: ["array"] }));
    expect(searchProblems).toHaveBeenCalledWith({ category: "algorithms", tags: ["array"], difficulty: "MEDIUM", offset: 7, limit: 10 });
    expect(found).toHaveLength(5);
    expect(found[0]).toEqual({ title: "Problem 0", difficulty: "Medium", url: "https://leetcode.com/problems/p-0/" });
    expect(JSON.stringify(found)).not.toContain("secret");
  });

  it("refuses more than 3 tags", async () => {
    const findTool = createFindProblemTool({ searchProblems: vi.fn() });
    await expect(findTool.invoke({ difficulty: "EASY", tags: ["a", "b", "c", "d"] })).rejects.toThrow();
  });

  it("tells the model to invent a classic problem when LeetCode fails", async () => {
    const findTool = createFindProblemTool({ searchProblems: vi.fn().mockRejectedValue(new Error("403")) });
    expect(await findTool.invoke({ difficulty: "EASY" })).toBe("LeetCode search failed; invent a classic problem instead.");
  });
});
