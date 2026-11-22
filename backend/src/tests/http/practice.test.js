import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, authAs, PRINCIPALS } from "../helpers/testApp.js";

// /api/practice through the real container: stub prisma, fake agents (no model, no key).
const { practiceOf, demo, candidateOf } = PRINCIPALS;
const STARTED = new Date();
const session = (extra = {}) => ({
  id: "s1", interviewId: "iv-1", status: "active", language: "python", code: null, report: null,
  messageCount: 0, startedAt: STARTED, finishedAt: null, ...extra,
});

let prisma;
let practiceInterviewer;
let practiceCoach;
let codeRunner;
let app;

beforeEach(() => {
  prisma = {
    interview: {
      findUnique: vi.fn().mockResolvedValue({
        id: "iv-1", interviewerId: "u-ada", role: "Backend", interviewType: "technical", practiceCreatedAt: new Date(Date.now() - 60_000),
      }),
    },
    aiPracticeSession: {
      create: vi.fn(async ({ data }) => session(data)),
      findUnique: vi.fn(async ({ where }) => (where.id === "s1" ? session() : null)),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({ id: "s1" }),
    },
  };
  practiceInterviewer = {
    streamTurn: vi.fn(async function* () {
      yield { type: "tool", name: "find_problem" };
      yield { type: "token", text: "Hello " };
      yield { type: "token", text: "there" };
      yield { type: "done", ended: false, limited: false };
    }),
    history: vi.fn().mockResolvedValue([{ role: "interviewer", text: "Hello there" }]),
  };
  practiceCoach = { review: vi.fn().mockResolvedValue({ summary: "ok" }) };
  codeRunner = { runCode: vi.fn().mockResolvedValue({ output: "1\n", stdout: "1\n", stderr: "", exitCode: 0, timedOut: false }) };
  ({ app } = buildTestApp({ prisma, principal: practiceOf("iv-1"), practiceInterviewer, practiceCoach, codeRunner }));
});

describe("/api/practice", () => {
  it("POST /sessions starts a session", async () => {
    const res = await request(app).post("/api/practice/sessions").send({ language: "python" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "s1", status: "active", language: "python" });
    expect(prisma.aiPracticeSession.create).toHaveBeenCalledWith({ data: { interviewId: "iv-1", language: "python" } });
  });

  it("GET /sessions/:sid returns state and history, 404 for another interview's session", async () => {
    const res = await request(app).get("/api/practice/sessions/s1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "s1", reportStatus: "none", messages: [{ role: "interviewer", text: "Hello there" }] });
    expect((await request(app).get("/api/practice/sessions/s1").set(authAs(practiceOf("iv-2")))).status).toBe(404);
    expect((await request(app).get("/api/practice/sessions/nope")).status).toBe(404);
  });

  it("POST /sessions/:sid/messages streams the turn as server-sent events", async () => {
    const res = await request(app)
      .post("/api/practice/sessions/s1/messages")
      .send({ text: "hi", code: "print(1)", language: "python" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.text).toBe(
      'event: tool\ndata: {"name":"find_problem"}\n\n' +
        'event: token\ndata: {"text":"Hello "}\n\n' +
        'event: token\ndata: {"text":"there"}\n\n' +
        'event: done\ndata: {"ended":false,"limited":false}\n\n',
    );
    expect(practiceInterviewer.streamTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", text: "hi", code: "print(1)", role: "Backend", signal: expect.any(AbortSignal) }),
    );
  });

  it("a failing agent ends the stream with a generic error event, never the error's text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    practiceInterviewer.streamTurn.mockImplementation(async function* () {
      yield { type: "token", text: "Hel" };
      throw new Error("OPENAI_API_KEY invalid sk-123");
    });
    const res = await request(app).post("/api/practice/sessions/s1/messages").send({ text: "hi", code: "", language: "python" });
    expect(res.text).toContain('event: error\ndata: {"message":"The interviewer is unavailable right now."}');
    expect(res.text).not.toContain("sk-123");
  });

  it("refusals before the stream are plain JSON errors", async () => {
    prisma.aiPracticeSession.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post("/api/practice/sessions/s1/messages").send({ text: "hi", code: "", language: "python" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Message limit reached" });
  });

  it("validates the message body", async () => {
    const empty = await request(app).post("/api/practice/sessions/s1/messages").send({ text: "", code: "", language: "python" });
    expect(empty.status).toBe(400);
    const tooLong = await request(app).post("/api/practice/sessions/s1/messages").send({ text: "x".repeat(4001), code: "", language: "python" });
    expect(tooLong.status).toBe(400);
  });

  it("POST /sessions/:sid/finish closes the session and writes the report", async () => {
    const res = await request(app).post("/api/practice/sessions/s1/finish");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "finished" });
    await vi.waitFor(() => expect(prisma.aiPracticeSession.update).toHaveBeenCalledWith({
      where: { id: "s1" }, data: { report: { summary: "ok" } }, select: { id: true },
    }));
  });

  it("POST /run runs code on the link's own budget", async () => {
    const res = await request(app).post("/api/practice/run").send({ language: "python", code: "print(1)" });
    expect(res.status).toBe(200);
    expect(res.body.output).toBe("1\n");
  });

  it("aborts the agent when the candidate disconnects mid-answer", async () => {
    let seenSignal;
    practiceInterviewer.streamTurn.mockImplementation(async function* ({ signal }) {
      seenSignal = signal;
      yield { type: "token", text: "Thinking" };
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const server = app.listen(0);
    try {
      const client = new AbortController();
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/practice/sessions/s1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi", code: "", language: "python" }),
        signal: client.signal,
      });
      await res.body.getReader().read(); // first event arrived
      client.abort();
      await vi.waitFor(() => expect(seenSignal.aborted).toBe(true));
    } finally {
      server.close();
    }
  });

  it("accepts only practice links: demo and candidate callers get 401", async () => {
    expect((await request(app).post("/api/practice/sessions").set(authAs(demo)).send({ language: "python" })).status).toBe(401);
    expect((await request(app).get("/api/practice/sessions/s1").set(authAs(candidateOf("iv-1")))).status).toBe(401);
  });
});
