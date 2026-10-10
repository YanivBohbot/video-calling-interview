import { describe, it, expect, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { buildGraph, startQuestionGeneration, resumeQuestionGeneration } from "./graph.js";
import { AIInvalidResponseError, UnknownJobError } from "./errors.js";

const goodQuestions = [
  { text: "Explain closures", category: "technical", difficulty: "medium" },
  { text: "Describe a conflict you resolved", category: "behavioral", difficulty: "easy" },
];

const makeDeps = ({ draftQuestions = goodQuestions, update = vi.fn().mockResolvedValue({}) } = {}) => ({
  checkpointer: new MemorySaver(),
  buildResearcherAgent: async () => ({
    invoke: vi.fn().mockResolvedValue({ structuredResponse: { usedLeetCode: false, notes: "" } }),
  }),
  buildDrafterAgent: async () => ({
    invoke: vi.fn().mockResolvedValue({ structuredResponse: { questions: draftQuestions } }),
  }),
  prismaClient: { interview: { update } },
});

describe("question generator graph", () => {
  it("runs to the human approval interrupt and returns the draft", async () => {
    const graph = buildGraph(makeDeps());
    const result = await startQuestionGeneration(
      { interviewId: "iv-1", role: "Backend Engineer", interviewType: "technical", count: 2 },
      { graph },
    );
    expect(result.jobId).toBeTypeOf("string");
    expect(result.draftQuestions).toEqual(goodQuestions);
    expect(result.plan.categoryCounts).toBeDefined();
  });

  it("persists on approve and reports approved: true", async () => {
    const update = vi.fn().mockResolvedValue({});
    const graph = buildGraph(makeDeps({ update }));
    const { jobId } = await startQuestionGeneration(
      { interviewId: "iv-2", role: "x", interviewType: "technical", count: 2 },
      { graph },
    );
    const result = await resumeQuestionGeneration(
      { interviewId: "iv-2", jobId, approved: true, questions: goodQuestions },
      { graph },
    );
    expect(result).toEqual({ approved: true });
    expect(update).toHaveBeenCalledWith({ where: { id: "iv-2" }, data: { questions: goodQuestions } });
  });

  it("does not write to the database on reject", async () => {
    const update = vi.fn().mockResolvedValue({});
    const graph = buildGraph(makeDeps({ update }));
    const { jobId } = await startQuestionGeneration(
      { interviewId: "iv-3", role: "x", interviewType: "technical", count: 2 },
      { graph },
    );
    const result = await resumeQuestionGeneration({ interviewId: "iv-3", jobId, approved: false }, { graph });
    expect(result).toEqual({ approved: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects resuming a job that was never started, without writing", async () => {
    const update = vi.fn().mockResolvedValue({});
    const graph = buildGraph(makeDeps({ update }));
    await expect(
      resumeQuestionGeneration({ interviewId: "iv-5", jobId: "never-started", approved: true }, { graph }),
    ).rejects.toBeInstanceOf(UnknownJobError);
    expect(update).not.toHaveBeenCalled();
  });

  it("a jobId minted for one interview cannot resume or write to another", async () => {
    const update = vi.fn().mockResolvedValue({});
    const graph = buildGraph(makeDeps({ update }));
    const { jobId } = await startQuestionGeneration(
      { interviewId: "iv-7", role: "x", interviewType: "technical", count: 2 },
      { graph },
    );
    await expect(
      resumeQuestionGeneration({ interviewId: "iv-8", jobId, approved: true }, { graph }),
    ).rejects.toBeInstanceOf(UnknownJobError);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects approving the same job twice, writing only once", async () => {
    const update = vi.fn().mockResolvedValue({});
    const graph = buildGraph(makeDeps({ update }));
    const { jobId } = await startQuestionGeneration(
      { interviewId: "iv-6", role: "x", interviewType: "technical", count: 2 },
      { graph },
    );
    await resumeQuestionGeneration({ interviewId: "iv-6", jobId, approved: true }, { graph });
    await expect(
      resumeQuestionGeneration({ interviewId: "iv-6", jobId, approved: true }, { graph }),
    ).rejects.toBeInstanceOf(UnknownJobError);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("reaches fallback then throws AIInvalidResponseError when the draft is always invalid", async () => {
    const graph = buildGraph(makeDeps({ draftQuestions: [] }));
    await expect(
      startQuestionGeneration(
        { interviewId: "iv-4", role: "x", interviewType: "technical", count: 2 },
        { graph },
      ),
    ).rejects.toBeInstanceOf(AIInvalidResponseError);
  });
});
