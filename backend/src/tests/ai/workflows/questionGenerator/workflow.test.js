import { describe, it, expect, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { workflow } from "../../../../ai/workflows/questionGenerator/workflow.js";
import { createQuestionGenerator } from "../../../../ai/workflows/questionGenerator/generator.js";
import { AIConfigError, AIInvalidResponseError, UnknownJobError } from "../../../../ai/workflows/questionGenerator/errors.js";

const goodQuestions = [
  { text: "Explain closures", category: "technical", difficulty: "medium" },
  { text: "Describe a conflict you resolved", category: "behavioral", difficulty: "easy" },
];

// `update` stands in for interviewRepository.saveQuestions(interviewId, questions).
const makeDeps = ({ draftQuestions = goodQuestions, update = vi.fn().mockResolvedValue({}) } = {}) => ({
  checkpointer: new MemorySaver(),
  chooseSearch: async () => ({ category: "algorithms", tags: [], difficulty: "MEDIUM" }),
  searchProblems: async () => [],
  draft: async () => ({ questions: draftQuestions }),
  saveQuestions: update,
});

// The real workflow, compiled with an in-memory checkpointer; the fakes are its runtime context.
const buildGraph = ({ checkpointer, ...context }) => ({ graph: workflow.compile({ checkpointer }), context });

// The public API (start/resume) over that graph.
const generatorFor = ({ graph, context }) => createQuestionGenerator({ graph, context });
const startQuestionGeneration = (args, { graph }) => generatorFor(graph).start(args);
const resumeQuestionGeneration = (args, { graph }) => generatorFor(graph).resume(args);

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
    expect(update).toHaveBeenCalledWith("iv-2", goodQuestions);
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

  it("a finalize DB failure leaves the approval retryable instead of stranding the job", async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error("db blip")).mockResolvedValue({});
    const graph = buildGraph(makeDeps({ update }));
    const { jobId } = await startQuestionGeneration(
      { interviewId: "iv-9", role: "x", interviewType: "technical", count: 2 },
      { graph },
    );
    await expect(
      resumeQuestionGeneration({ interviewId: "iv-9", jobId, approved: true, questions: goodQuestions }, { graph }),
    ).rejects.toThrow();
    const result = await resumeQuestionGeneration(
      { interviewId: "iv-9", jobId, approved: true, questions: goodQuestions },
      { graph },
    );
    expect(result).toEqual({ approved: true });
    expect(update).toHaveBeenLastCalledWith("iv-9", goodQuestions);
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

  it("lets a model configuration error reach the API as AIConfigError", async () => {
    const graph = buildGraph({ ...makeDeps(), draft: async () => { throw new AIConfigError("bad model"); } });
    await expect(
      startQuestionGeneration({ interviewId: "iv-10", role: "x", interviewType: "technical", count: 2 }, { graph }),
    ).rejects.toBeInstanceOf(AIConfigError);
  });
});
