import { describe, it, expect, vi } from "vitest";
import { fakeModel, AIMessage } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { createPracticeInterviewer } from "../../../agents/practiceInterviewer/index.js";

const LANGUAGES = ["javascript", "python"];
const TURN = { role: "Backend engineer", interviewType: "technical", code: "def two_sum(): pass", language: "python" };

const build = (model, overrides = {}) => {
  const deps = {
    model,
    runCode: vi.fn().mockResolvedValue({ output: "ok\n", exitCode: 0, timedOut: false }),
    searchProblems: vi.fn().mockResolvedValue([{ slug: "two-sum", title: "Two Sum", difficulty: "Easy" }]),
    languages: LANGUAGES,
    checkpointer: new MemorySaver(),
    ...overrides,
  };
  return { interviewer: createPracticeInterviewer(deps), deps };
};

const collect = async (events) => {
  const out = [];
  for await (const event of events) out.push(event);
  return out;
};

describe("practice interviewer agent", () => {
  it("opens with find_problem, streams its answer, and reports the turn", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "find_problem", args: { difficulty: "EASY", tags: [] } }])
      .respond(new AIMessage("Here is your problem, inspired by Two Sum (https://leetcode.com/problems/two-sum/)."));
    const { interviewer, deps } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "Hi, I'm ready.", ...TURN }));
    expect(events[0]).toEqual({ type: "tool", name: "find_problem" });
    const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
    expect(text).toContain("Two Sum");
    expect(events.at(-1)).toEqual({ type: "done", ended: false, limited: false });
    expect(deps.searchProblems).toHaveBeenCalledTimes(1);
  });

  it("gives read_candidate_code the code sent with this message", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_candidate_code", args: {} }])
      .respond((messages) => new AIMessage(`I see: ${messages.at(-1).content}`));
    const { interviewer } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "Done?", ...TURN }));
    expect(events.filter((e) => e.type === "token").map((e) => e.text).join("")).toContain("def two_sum(): pass");
  });

  it("reports ended when the agent calls end_session", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "end_session", args: { reason: "solved" } }])
      .respond(new AIMessage("Great job, goodbye!"));
    const { interviewer } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "I'm done", ...TURN }));
    expect(events.at(-1)).toEqual({ type: "done", ended: true, limited: false });
  });

  it("stops a looping turn after 6 model calls and reports limited", async () => {
    const model = fakeModel();
    for (let i = 0; i < 10; i++) model.respondWithTools([{ name: "run_code", args: { language: "python", code: "1" } }]);
    const { interviewer } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "Run it", ...TURN }));
    expect(model.callCount).toBe(6);
    expect(events.at(-1)).toEqual({ type: "done", ended: false, limited: true });
  });

  it("history keeps the conversation only: no tool messages, no limit message", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "read_candidate_code", args: {} }])
      .respond(new AIMessage("First answer"))
      .respond(new AIMessage("Second answer"));
    const { interviewer } = build(model);
    await collect(interviewer.streamTurn({ sessionId: "s1", text: "one", ...TURN }));
    await collect(interviewer.streamTurn({ sessionId: "s1", text: "two", ...TURN }));
    expect(await interviewer.history("s1")).toEqual([
      { role: "candidate", text: "one" },
      { role: "interviewer", text: "First answer" },
      { role: "candidate", text: "two" },
      { role: "interviewer", text: "Second answer" },
    ]);
    expect(await interviewer.history("other")).toEqual([]);
  });

  it("stops when the candidate disconnects (abort signal)", async () => {
    const model = fakeModel();
    for (let i = 0; i < 6; i++) model.respondWithTools([{ name: "run_code", args: { language: "python", code: "1" } }]);
    const slowRun = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ output: "", exitCode: 0, timedOut: false }), 200)));
    const { interviewer } = build(model, { runCode: slowRun });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    await expect(collect(interviewer.streamTurn({ sessionId: "s1", text: "go", ...TURN, signal: controller.signal }))).rejects.toThrow();
    const callsAtAbort = model.callCount;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(model.callCount).toBe(callsAtAbort);
    expect(callsAtAbort).toBeLessThan(6);
  });
});
