import { describe, it, expect, vi } from "vitest";
import { Command } from "@langchain/langgraph";
import { ToolMessage } from "@langchain/core/messages";
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

  const toolResult = new ToolMessage({
    content: JSON.stringify({
      problems: {
        questions: [
          { title: "Second Highest Salary", titleSlug: "second-highest-salary", difficulty: "Medium" },
          { title: "Rank Scores", titleSlug: "rank-scores", difficulty: "Medium" },
        ],
      },
    }),
    tool_call_id: "call-1",
    name: "search_problems",
  });

  it("keeps only tool-returned, distinct problems, capped at the technical question count", async () => {
    const agent = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          problems: [{ slug: "ghost" }, { slug: "rank-scores" }, { slug: "rank-scores" }, { slug: "second-highest-salary" }],
        },
        messages: [toolResult],
      }),
    };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent, random: () => 0 });
    const result = await node({ plan: { categoryCounts: { technical: 1 } }, role: "Senior Backend Engineer", interviewType: "technical" });
    expect(result).toEqual({ research: [{ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" }] });
  });

  it("tells the agent how many problems it needs and a varied search offset", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { problems: [] }, messages: [] }) };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent, random: () => 0.5 });
    await node({ plan: { categoryCounts: { technical: 3 } }, role: "Junior Frontend Engineer", interviewType: "technical" });
    const content = agent.invoke.mock.calls[0][0].messages[0].content;
    expect(content).toContain("Junior Frontend Engineer");
    expect(content).toContain("Technical questions to ground: 3");
    expect(content).toContain("offset 20");
  });

  it("returns no research when the agent picked nothing", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { problems: [] }, messages: [toolResult] }) };
    const node = makeResearcherNode({ buildResearcherAgent: async () => agent });
    expect(await node({ plan: { categoryCounts: { technical: 2 } }, role: "x", interviewType: "technical" })).toEqual({ research: [] });
  });

  it("does not throw when the LeetCode MCP connection is unavailable (agent builder rejects)", async () => {
    const node = makeResearcherNode({ buildResearcherAgent: async () => { throw new Error("MCP connection failed"); } });
    await expect(
      node({ plan: { categoryCounts: { technical: 4 } }, role: "x", interviewType: "technical" }),
    ).resolves.toEqual({ research: [] });
  });

  it("logs the error when it degrades, so a persistent failure is visible", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const node = makeResearcherNode({
      buildResearcherAgent: async () => ({ invoke: vi.fn().mockRejectedValue(new Error("400 Invalid schema")) }),
    });
    await node({ plan: { categoryCounts: { technical: 4 } }, role: "x", interviewType: "technical" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("researcher"), "400 Invalid schema");
    warn.mockRestore();
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
      research: [{ slug: "two-sum", title: "Two Sum", difficulty: "Easy" }],
      useFallbackModel: false,
      count: 1,
      role: "x",
      interviewType: "technical",
    });
    const content = agent.invoke.mock.calls[0][0].messages[0].content;
    expect(content).toContain("two-sum — Two Sum (Easy)");
    expect(content).toContain("Generate exactly 1");
    expect(content).not.toContain("rejected");
  });

  it("turns the model's sourceSlug into a verified source on technical questions only", async () => {
    const agent = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          questions: [
            { text: "Rank players by score", category: "technical", difficulty: "medium", sourceSlug: "rank-scores" },
            { text: "Tell me about a conflict", category: "behavioral", difficulty: "easy", sourceSlug: "rank-scores" },
          ],
        },
      }),
    };
    const node = makeDrafterNode({ buildDrafterAgent: async () => agent });
    const { draftQuestions } = await node({
      plan: { categoryCounts: { technical: 1, behavioral: 1 } },
      research: [{ slug: "rank-scores", title: "Rank Scores", difficulty: "Medium" }],
      useFallbackModel: false,
      count: 2,
      role: "x",
      interviewType: "technical",
    });
    expect(draftQuestions[0].source).toEqual({
      type: "leetcode",
      title: "Rank Scores",
      slug: "rank-scores",
      difficulty: "Medium",
      url: "https://leetcode.com/problems/rank-scores/",
    });
    expect(draftQuestions[1].source).toBeUndefined();
    expect("sourceSlug" in draftQuestions[0]).toBe(false);
  });

  it("tells the model what was wrong with its previous draft on a retry", async () => {
    const agent = { invoke: vi.fn().mockResolvedValue({ structuredResponse: { questions: sampleQuestions } }) };
    const node = makeDrafterNode({ buildDrafterAgent: async () => agent });
    await node({
      plan: { categoryCounts: { technical: 1 } },
      research: [],
      useFallbackModel: false,
      count: 1,
      role: "x",
      interviewType: "technical",
      validationErrors: ['duplicate question: "Explain closures"'],
    });
    const content = agent.invoke.mock.calls[0][0].messages[0].content;
    expect(content).toContain("Your previous draft was rejected");
    expect(content).toContain('duplicate question: "Explain closures"');
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

  it("rejects two questions built on the same LeetCode problem", async () => {
    const source = { type: "leetcode", title: "Rank Scores", slug: "rank-scores", difficulty: "Medium", url: "https://leetcode.com/problems/rank-scores/" };
    const result = await validatorNode({
      draftQuestions: [
        { text: "Q one", category: "technical", difficulty: "medium", source },
        { text: "Q two", category: "technical", difficulty: "medium", source },
      ],
      count: 2,
      retryCount: 0,
      useFallbackModel: false,
    });
    expect(result.goto).toEqual(["drafter"]);
    expect(result.update.validationErrors.some((e) => e.includes("rank-scores"))).toBe(true);
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
