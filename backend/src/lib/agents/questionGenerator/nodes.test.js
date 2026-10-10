import { describe, it, expect, vi } from "vitest";
import { distributeCounts, makePlannerNode, makeResearcherNode } from "./nodes.js";

describe("distributeCounts", () => {
  it("splits counts proportionally and sums to the total, largest remainder first", () => {
    const result = distributeCounts(6, { technical: 0.6, behavioral: 0.25, "system-design": 0.15 });
    expect(result).toEqual({ technical: 4, behavioral: 1, "system-design": 1 });
    expect(Object.values(result).reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe("planner node", () => {
  const plannerNode = makePlannerNode();

  it("biases toward behavioral for a behavioral interview", async () => {
    const result = await plannerNode({ interviewType: "behavioral", count: 6 });
    expect(result).toEqual({ plan: { categoryCounts: { behavioral: 4, technical: 2, "system-design": 0 } } });
  });

  it("defaults to the technical weighting for an unknown interviewType", async () => {
    const result = await plannerNode({ interviewType: "unknown-type", count: 6 });
    expect(result.plan.categoryCounts.technical).toBeGreaterThan(result.plan.categoryCounts.behavioral);
  });
});

describe("researcher node", () => {
  it("skips the agent entirely when the plan has no technical questions", async () => {
    const buildResearcherAgent = vi.fn();
    const node = makeResearcherNode({ buildResearcherAgent });
    const result = await node({ plan: { categoryCounts: { technical: 0, behavioral: 6 } } });
    expect(result).toEqual({ research: [] });
    expect(buildResearcherAgent).not.toHaveBeenCalled();
  });

  it("returns the agent's notes when it used LeetCode", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { usedLeetCode: true, notes: "Grounded in Two Sum" } }) };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent });
    const result = await node({ plan: { categoryCounts: { technical: 4 } }, role: "Backend Engineer", interviewType: "technical" });
    expect(result).toEqual({ research: ["Grounded in Two Sum"] });
  });

  it("returns no research when the agent chose not to use LeetCode", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { usedLeetCode: false, notes: "" } }) };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent });
    const result = await node({ plan: { categoryCounts: { technical: 4 } }, role: "x", interviewType: "technical" });
    expect(result).toEqual({ research: [] });
  });

  it("does not throw when the LeetCode MCP connection is unavailable (agent builder rejects)", async () => {
    const node = makeResearcherNode({ buildResearcherAgent: async () => { throw new Error("MCP connection failed"); } });
    await expect(
      node({ plan: { categoryCounts: { technical: 4 } }, role: "x", interviewType: "technical" }),
    ).resolves.toEqual({ research: [] });
  });
});
