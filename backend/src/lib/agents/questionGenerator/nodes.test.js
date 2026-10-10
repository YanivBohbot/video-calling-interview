import { describe, it, expect } from "vitest";
import { distributeCounts, makePlannerNode } from "./nodes.js";

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
