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
  const problems = (n, prefix = "p") =>
    Array.from({ length: n }, (_, i) => ({ slug: `${prefix}-${i}`, title: `P ${i}`, difficulty: "Medium" }));
  const query = { category: "database", tags: ["hash-table", "sorting"], difficulty: "MEDIUM" };
  const state = (technical, role = "Senior Backend Engineer") => ({
    plan: { categoryCounts: { technical } },
    role,
    interviewType: "technical",
  });

  it("skips research entirely when the plan has no technical questions", async () => {
    const chooseSearch = vi.fn();
    const node = makeResearcherNode({ chooseSearch, searchProblems: vi.fn() });
    expect(await node({ plan: { categoryCounts: { technical: 0, behavioral: 6 } } })).toEqual({ research: [] });
    expect(chooseSearch).not.toHaveBeenCalled();
  });

  it("asks the model for filters, then searches with them, a bounded random offset and room to sample", async () => {
    const chooseSearch = vi.fn().mockResolvedValue(query);
    const searchProblems = vi.fn().mockResolvedValue(problems(9));
    const node = makeResearcherNode({ chooseSearch, searchProblems, random: () => 0.999 });
    await node(state(3, "Junior Frontend Engineer"));
    expect(chooseSearch).toHaveBeenCalledWith({ role: "Junior Frontend Engineer", interviewType: "technical" });
    expect(searchProblems).toHaveBeenCalledWith({ ...query, offset: 20, limit: 9 });
  });

  it("returns exactly the technical count of distinct problems from the results", async () => {
    const found = [...problems(6), problems(1)[0]];
    const node = makeResearcherNode({
      chooseSearch: async () => query,
      searchProblems: async () => found,
      random: () => 0.3,
    });
    const { research } = await node(state(4));
    expect(research).toHaveLength(4);
    expect(new Set(research.map((p) => p.slug)).size).toBe(4);
    for (const p of research) expect(found).toContainEqual(p);
  });

  it("samples differently for different random draws (Regenerate gives new problems)", async () => {
    const run = async (r) => {
      const node = makeResearcherNode({ chooseSearch: async () => query, searchProblems: async () => problems(12), random: () => r });
      return (await node(state(4))).research.map((p) => p.slug).join(",");
    };
    expect(await run(0.1)).not.toBe(await run(0.9));
  });

  it("falls back to offset 0, then to fewer filters, when a search comes back empty", async () => {
    const searchProblems = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue(problems(5));
    const node = makeResearcherNode({ chooseSearch: async () => query, searchProblems, random: () => 0.5 });
    const { research } = await node(state(2));
    expect(research).toHaveLength(2);
    expect(searchProblems.mock.calls.map(([p]) => p)).toEqual([
      { ...query, offset: 10, limit: 6 },
      { ...query, offset: 0, limit: 6 },
      { category: "database", difficulty: "MEDIUM", offset: 0, limit: 6 },
    ]);
  });

  it("returns no research when every search is empty", async () => {
    const node = makeResearcherNode({ chooseSearch: async () => query, searchProblems: async () => [] });
    expect(await node(state(2))).toEqual({ research: [] });
  });

  it("does not throw when the LeetCode MCP connection is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const node = makeResearcherNode({
      chooseSearch: async () => query,
      searchProblems: async () => {
        throw new Error("MCP connection failed");
      },
    });
    await expect(node(state(4))).resolves.toEqual({ research: [] });
    warn.mockRestore();
  });

  it("logs the error when it degrades, so a persistent failure is visible", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const node = makeResearcherNode({
      chooseSearch: async () => {
        throw new Error("400 Invalid schema");
      },
      searchProblems: vi.fn(),
    });
    await node(state(4));
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

  it("rejects a draft whose category mix doesn't match the plan", async () => {
    const result = await validatorNode({
      plan: { categoryCounts: { technical: 2, behavioral: 1 } },
      draftQuestions: [
        { text: "Tech one", category: "technical", difficulty: "medium" },
        { text: "Design a chat app", category: "system-design", difficulty: "hard" },
        { text: "A conflict you solved", category: "behavioral", difficulty: "easy" },
      ],
      count: 3,
      retryCount: 0,
      useFallbackModel: false,
    });
    expect(result.goto).toEqual(["drafter"]);
    expect(result.update.validationErrors.some((e) => e.includes("expected 2 technical"))).toBe(true);
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
