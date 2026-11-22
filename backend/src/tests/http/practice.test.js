import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildTestApp, authAs, PRINCIPALS } from "../helpers/testApp.js";

// /api/interviews/:id/ai through the real container: stub prisma, fake agents (no model, no key).
// The invited candidate chats; the owner (ada) reads; everyone else sees nothing.
const { ada, bob, candidateOf } = PRINCIPALS;
const AI = "/api/interviews/iv-1/ai";
const STARTED = new Date();
const session = (extra = {}) => ({
  id: "s1", interviewId: "iv-1", status: "active", language: "python", code: null, report: null,
  messageCount: 0, startedAt: STARTED, finishedAt: null, ...extra,
});

let prisma;
let practiceInterviewer;
let practiceCoach;
let app;

beforeEach(() => {
  prisma = {
    interview: {
      findUnique: vi.fn(async ({ where }) =>
        where.id === "iv-1" ? { id: "iv-1", interviewerId: "u-ada", role: "Backend", interviewType: "technical" } : null,
      ),
    },
    $transaction: vi.fn(async (fn) => fn(prisma)),
    $executeRaw: vi.fn().mockResolvedValue(1),
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
  ({ app } = buildTestApp({ prisma, principal: candidateOf("iv-1"), practiceInterviewer, practiceCoach }));
});

describe("/api/interviews/:id/ai", () => {
  it("POST /sessions starts a session", async () => {
    const res = await request(app).post(`${AI}/sessions`).send({ language: "python" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "s1", status: "active", language: "python" });
    expect(prisma.aiPracticeSession.create).toHaveBeenCalledWith({ data: { interviewId: "iv-1", language: "python" } });
  });

  it("GET /sessions/:sid returns state and history, 404 for another interview's session", async () => {
    const res = await request(app).get(`${AI}/sessions/s1`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "s1", reportStatus: "none", messages: [{ role: "interviewer", text: "Hello there" }] });
    expect((await request(app).get(`${AI}/sessions/s1`).set(authAs(candidateOf("iv-2")))).status).toBe(404);
    expect((await request(app).get(`${AI}/sessions/nope`)).status).toBe(404);
  });

  it("POST /sessions/:sid/messages streams the turn as server-sent events", async () => {
    const res = await request(app)
      .post(`${AI}/sessions/s1/messages`)
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
    const res = await request(app).post(`${AI}/sessions/s1/messages`).send({ text: "hi", code: "", language: "python" });
    expect(res.text).toContain('event: error\ndata: {"message":"The interviewer is unavailable right now."}');
    expect(res.text).not.toContain("sk-123");
  });

  it("refusals before the stream are plain JSON errors", async () => {
    prisma.aiPracticeSession.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post(`${AI}/sessions/s1/messages`).send({ text: "hi", code: "", language: "python" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Message limit reached" });
  });

  it("validates the message body", async () => {
    const empty = await request(app).post(`${AI}/sessions/s1/messages`).send({ text: "", code: "", language: "python" });
    expect(empty.status).toBe(400);
    const tooLong = await request(app).post(`${AI}/sessions/s1/messages`).send({ text: "x".repeat(4001), code: "", language: "python" });
    expect(tooLong.status).toBe(400);
  });

  it("POST /sessions/:sid/finish closes the session and writes the report", async () => {
    const res = await request(app).post(`${AI}/sessions/s1/finish`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "finished" });
    await vi.waitFor(() => expect(prisma.aiPracticeSession.update).toHaveBeenCalledWith({
      where: { id: "s1" }, data: { report: { summary: "ok" } }, select: { id: true },
    }));
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
      const res = await fetch(`http://127.0.0.1:${server.address().port}${AI}/sessions/s1/messages`, {
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

  it("GET /sessions/current answers the interview's latest session id", async () => {
    prisma.aiPracticeSession.findFirst.mockResolvedValue(session({ status: "finished" }));
    const res = await request(app).get(`${AI}/sessions/current`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: "s1" });
    expect(prisma.aiPracticeSession.findFirst).toHaveBeenCalledWith({ where: { interviewId: "iv-1" }, orderBy: { startedAt: "desc" } });
  });

  it("caps sessions per interview at 3", async () => {
    prisma.aiPracticeSession.count.mockResolvedValue(3);
    const res = await request(app).post(`${AI}/sessions`).send({ language: "python" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Practice limit reached" });
    expect(prisma.aiPracticeSession.count).toHaveBeenCalledWith({ where: { interviewId: "iv-1" } });
  });

  it("lets the owner read the session, report included, but not start or send", async () => {
    prisma.aiPracticeSession.findUnique.mockResolvedValue(session({ status: "finished", report: { summary: "ok" } }));
    const read = await request(app).get(`${AI}/sessions/s1`).set(authAs(ada));
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ reportStatus: "ready", report: { summary: "ok" }, messages: [{ role: "interviewer", text: "Hello there" }] });
    expect((await request(app).post(`${AI}/sessions`).set(authAs(ada)).send({ language: "python" })).status).toBe(403);
    const send = await request(app).post(`${AI}/sessions/s1/messages`).set(authAs(ada)).send({ text: "hi", code: "", language: "python" });
    expect(send.status).toBe(403);
    expect(practiceInterviewer.streamTurn).not.toHaveBeenCalled();
  });

  it("hides the interview's AI from everyone else", async () => {
    expect((await request(app).get(`${AI}/sessions/s1`).set(authAs(bob))).status).toBe(404);
    expect((await request(app).get(`${AI}/sessions/current`).set(authAs(bob))).status).toBe(404);
    expect((await request(app).get(`${AI}/sessions/s1`).set(authAs(candidateOf("iv-2")))).status).toBe(404);
    expect((await request(app).get(`${AI}/sessions/s1`).set(authAs(null))).status).toBe(401);
  });
});
