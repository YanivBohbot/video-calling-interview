import { describe, it, expect, vi } from "vitest";
import { fakeModel, AIMessage } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { createPracticeInterviewer } from "../../../agents/practiceInterviewer/index.js";

const LANGUAGES = ["javascript", "python"];
const TURN = { role: "Backend engineer", interviewType: "technical", code: "def two_sum(): pass", language: "python" };

// A model answer that only calls tools, with no words (as OpenAI usually sends it;
// fakeModel's respondWithTools would echo the prompt as the message's text).
let callCount = 0;
const toolCalls = (calls) =>
  new AIMessage({ content: "", tool_calls: calls.map((call) => ({ id: call.id ?? `call-${++callCount}`, ...call })) });

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
      .respond(toolCalls([{ name: "find_problem", args: { difficulty: "EASY", tags: [] } }]))
      .respond(new AIMessage("Here is your problem, inspired by Two Sum (https://leetcode.com/problems/two-sum/)."));
    const { interviewer, deps } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "Hi, I'm ready.", ...TURN }));
    expect(events[0]).toEqual({ type: "tool", name: "find_problem", endsSession: false });
    const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
    expect(text).toContain("Two Sum");
    expect(events.at(-1)).toEqual({ type: "done", ended: false, limited: false });
    expect(deps.searchProblems).toHaveBeenCalledTimes(1);
  });

  it("gives read_candidate_code the code sent with this message", async () => {
    const model = fakeModel()
      .respond(toolCalls([{ name: "read_candidate_code", args: {} }]))
      .respond((messages) => new AIMessage(`I see: ${messages.at(-1).content}`));
    const { interviewer } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "Done?", ...TURN }));
    expect(events.filter((e) => e.type === "token").map((e) => e.text).join("")).toContain("def two_sum(): pass");
  });

  it("reports ended when the agent calls end_session", async () => {
    const model = fakeModel()
      .respond(toolCalls([{ name: "end_session", args: { reason: "solved" } }]))
      .respond(new AIMessage("Great job, goodbye!"));
    const { interviewer } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "I'm done", ...TURN }));
    expect(events.at(-1)).toEqual({ type: "done", ended: true, limited: false });
    // Flagged at the tool call itself: the service needs no tool names.
    expect(events.filter((e) => e.type === "tool")).toEqual([{ type: "tool", name: "end_session", endsSession: true }]);
  });

  it("stops a looping turn after 6 model calls and reports limited", async () => {
    const model = fakeModel();
    for (let i = 0; i < 10; i++) model.respond(toolCalls([{ name: "run_code", args: { language: "python", code: "1" } }]));
    const { interviewer } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "Run it", ...TURN }));
    expect(model.callCount).toBe(6);
    expect(events.at(-1)).toEqual({ type: "done", ended: false, limited: true });
  });

  it("history keeps the conversation only: no tool messages, no limit message", async () => {
    const model = fakeModel()
      .respond(toolCalls([{ name: "read_candidate_code", args: {} }]))
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

  it("keeps the words the model wrote before a tool call, live and in the history", async () => {
    const model = fakeModel()
      .respond(new AIMessage({ content: "Let me run your code.", tool_calls: [{ id: "c1", name: "read_candidate_code", args: {} }] }))
      .respond(new AIMessage("All tests pass."));
    const { interviewer } = build(model);
    const events = await collect(interviewer.streamTurn({ sessionId: "s1", text: "Done", ...TURN }));
    const tokens = events.filter((e) => e.type === "token").map((e) => e.text).join("");
    expect(tokens).toContain("Let me run your code.");
    expect(await interviewer.history("s1")).toEqual([
      { role: "candidate", text: "Done" },
      { role: "interviewer", text: "Let me run your code." },
      { role: "interviewer", text: "All tests pass." },
    ]);
  });

  it("after a disconnect during a tool call, the next turn sends every tool call with its result", async () => {
    const model = fakeModel()
      .respond(toolCalls([{ name: "run_code", args: { language: "python", code: "1" }, id: "call-1" }]))
      .respond((messages) => new AIMessage(`seen ${messages.map((m) => m.type).join(",")}`));
    const blocked = vi.fn(() => new Promise(() => {})); // never answers: the candidate leaves first
    const { interviewer } = build(model, { runCode: blocked });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(collect(interviewer.streamTurn({ sessionId: "s1", text: "run it", ...TURN, signal: controller.signal }))).rejects.toThrow();
    await collect(interviewer.streamTurn({ sessionId: "s1", text: "I'm back", ...TURN }));
    const secondCall = model.calls.at(-1).messages;
    const toolCallIds = secondCall.flatMap((m) => m.tool_calls?.map((c) => c.id) ?? []);
    const answered = secondCall.filter((m) => m.type === "tool").map((m) => m.tool_call_id);
    expect(toolCallIds).toEqual(["call-1"]);
    expect(answered).toEqual(["call-1"]);
  });

  it("stops when the candidate disconnects (abort signal)", async () => {
    const model = fakeModel();
    for (let i = 0; i < 6; i++) model.respond(toolCalls([{ name: "run_code", args: { language: "python", code: "1" } }]));
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
