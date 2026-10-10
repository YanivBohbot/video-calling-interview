import { describe, it, expect, vi } from "vitest";
import { Command } from "@langchain/langgraph";
import {
  distributeCounts,
  makePlannerNode,
  makeResearcherNode,
  makeDrafterNode,
  validatorNode,
  fallbackNode,
  makeFinalizeNode,
} from "./nodes.js";
import { AIInvalidResponseError } from "./errors.js";

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

describe("drafter node", () => {
  const sampleQuestions = [{ text: "Explain closures", category: "technical", difficulty: "medium" }];

  it("returns the agent's drafted questions and passes the fallback flag through", async () => {
    const buildDrafterAgent = vi.fn().mockResolvedValue({
      invoke: vi.fn().mockResolvedValue({ structuredResponse: { questions: sampleQuestions } }),
    });
    const node = makeDrafterNode({ buildDrafterAgent });
    const result = await node({
      plan: { categoryCounts: { technical: 1 } },
      research: [],
      useFallbackModel: true,
      count: 1,
      role: "Backend Engineer",
      interviewType: "technical",
    });
    expect(result).toEqual({ draftQuestions: sampleQuestions });
    expect(buildDrafterAgent).toHaveBeenCalledWith(true);
  });

  it("includes research notes and the requested count in the user message", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { questions: sampleQuestions } }) };
    const node = makeDrafterNode({ buildDrafterAgent: async () => agent });
    await node({
      plan: { categoryCounts: { technical: 1 } },
      research: ["Grounded in Two Sum"],
      useFallbackModel: false,
      count: 1,
      role: "x",
      interviewType: "technical",
    });
    const content = agent.invoke.mock.calls[0][0].messages[0].content;
    expect(content).toContain("Grounded in Two Sum");
    expect(content).toContain("Generate exactly 1");
  });
});

describe("validator node", () => {
  const goodQuestions = [
    { text: "Explain closures", category: "technical", difficulty: "medium" },
    { text: "Describe a conflict you resolved", category: "behavioral", difficulty: "easy" },
  ];

  it("routes to humanApproval when the draft is valid", async () => {
    const result = await validatorNode({ draftQuestions: goodQuestions, count: 2, retryCount: 0, useFallbackModel: false });
    expect(result).toBeInstanceOf(Command);
    expect(result.goto).toEqual(["humanApproval"]);
    expect(result.update.validationErrors).toEqual([]);
  });

  it("catches a duplicate question and routes back to drafter while retries remain", async () => {
    const dup = [goodQuestions[0], { ...goodQuestions[0] }];
    const result = await validatorNode({ draftQuestions: dup, count: 2, retryCount: 0, useFallbackModel: false });
    expect(result.goto).toEqual(["drafter"]);
    expect(result.update.retryCount).toBe(1);
    expect(result.update.validationErrors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("routes to fallback once content retries are exhausted", async () => {
    const result = await validatorNode({ draftQuestions: [], count: 2, retryCount: 2, useFallbackModel: false });
    expect(result.goto).toEqual(["fallback"]);
  });

  it("throws AIInvalidResponseError when the fallback attempt also fails", async () => {
    await expect(
      validatorNode({ draftQuestions: [], count: 2, retryCount: 3, useFallbackModel: true }),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });

  it("catches a wrong question count", async () => {
    const result = await validatorNode({ draftQuestions: [goodQuestions[0]], count: 2, retryCount: 0, useFallbackModel: false });
    expect(result.goto).toEqual(["drafter"]);
    expect(result.update.validationErrors.some((e) => e.includes("expected 2"))).toBe(true);
  });
});

describe("fallback node", () => {
  it("sets useFallbackModel and bumps retryCount without resetting it", async () => {
    const result = await fallbackNode({ retryCount: 2 });
    expect(result).toEqual({ useFallbackModel: true, retryCount: 3 });
  });
});

describe("finalize node", () => {
  it("persists the approved (edited) questions, not the original draft", async () => {
    const update = vi.fn().mockResolvedValue({});
    const node = makeFinalizeNode({ prisma: { interview: { update } } });
    const edited = [{ text: "Edited question", category: "technical", difficulty: "hard" }];
    await node({
      interviewId: "iv-1",
      draftQuestions: [{ text: "Original", category: "technical", difficulty: "easy" }],
      approval: { approved: true, questions: edited },
    });
    expect(update).toHaveBeenCalledWith({ where: { id: "iv-1" }, data: { questions: edited } });
  });

  it("falls back to the original draft when approval carries no edited questions", async () => {
    const update = vi.fn().mockResolvedValue({});
    const node = makeFinalizeNode({ prisma: { interview: { update } } });
    const draft = [{ text: "Original", category: "technical", difficulty: "easy" }];
    await node({ interviewId: "iv-1", draftQuestions: draft, approval: { approved: true } });
    expect(update).toHaveBeenCalledWith({ where: { id: "iv-1" }, data: { questions: draft } });
  });
});
