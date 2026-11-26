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
    expect(prisma.aiPracticeSession.create).toHaveBeenCalledWith({ data: { interviewId: "iv-1", language: "python", mode: "text" } });
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

  it("POST /sessions/:sid/report writes a failed report again", async () => {
    prisma.aiPracticeSession.findUnique.mockResolvedValue(session({ status: "finished", report: { failed: true } }));
    expect((await request(app).post(`${AI}/sessions/s1/report`)).status).toBe(403); // the candidate
    const res = await request(app).post(`${AI}/sessions/s1/report`).set(authAs(ada));
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ reportStatus: "pending" });
    await vi.waitFor(() => expect(prisma.aiPracticeSession.update).toHaveBeenCalledWith({
      where: { id: "s1" }, data: { report: { summary: "ok" } }, select: { id: true },
    }));
    prisma.aiPracticeSession.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).post(`${AI}/sessions/s1/report`).set(authAs(ada))).status).toBe(409);
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

  it("allows one AI session per interview", async () => {
    prisma.aiPracticeSession.count.mockResolvedValue(1);
    const res = await request(app).post(`${AI}/sessions`).send({ language: "python" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "The AI interview of this interview has already taken place" });
    expect(prisma.aiPracticeSession.count).toHaveBeenCalledWith({ where: { interviewId: "iv-1" } });
  });

  it("gives the candidate the conversation of a finished session, never its report", async () => {
    prisma.aiPracticeSession.findUnique.mockResolvedValue(session({ status: "finished", report: { summary: "ok" } }));
    const res = await request(app).get(`${AI}/sessions/s1`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "finished", reportStatus: "none", report: null });
    expect(JSON.stringify(res.body)).not.toContain("summary");
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

// Avatar mode: the candidate runs the interview with a LiveAvatar avatar driven by our agent.
describe("/api/interviews/:id/ai avatar mode", () => {
  const QUESTIONS = [
    { text: "Tell me about a conflict", category: "behavioral", difficulty: "easy", source: { slug: "secret-src" } },
    { text: "Two sum", category: "technical", difficulty: "medium", source: { slug: "two-sum-src" } },
  ];
  let interview;
  let liveAvatar;
  let stored;

  const build = (fakes = {}) =>
    buildTestApp({ prisma, principal: candidateOf("iv-1"), practiceInterviewer, practiceCoach, liveAvatar, ...fakes });

  beforeEach(() => {
    interview = {
      id: "iv-1", interviewerId: "u-ada", role: "Backend", interviewType: "technical",
      company: "Acme", interviewLanguage: "he", aiInterviewerEnabled: true, questions: QUESTIONS,
    };
    prisma.interview.findUnique.mockImplementation(async ({ where }) => (where.id === "iv-1" ? interview : null));
    stored = { mode: "avatar", presentedIndex: null, avatarTokens: 0 };
    prisma.aiPracticeSession.findUnique.mockImplementation(async ({ where }) => (where.id === "s1" ? session(stored) : null));
    prisma.aiPracticeSession.update.mockImplementation(async ({ data }) => {
      if ("presentedIndex" in data) stored.presentedIndex = data.presentedIndex;
      return { id: "s1" };
    });
    liveAvatar = { createSessionToken: vi.fn().mockResolvedValue({ sessionToken: "lat-123" }) };
    ({ app } = build());
  });

  const startAvatar = (a = app) => request(a).post(`${AI}/sessions`).send({ language: "python", mode: "avatar" });

  it("starts an avatar session, mode stored", async () => {
    const res = await startAvatar();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "s1", mode: "avatar" });
    expect(prisma.aiPracticeSession.create).toHaveBeenCalledWith({ data: { interviewId: "iv-1", language: "python", mode: "avatar" } });
  });

  it("refuses an avatar start when the interview did not enable it", async () => {
    interview.aiInterviewerEnabled = false;
    const res = await startAvatar();
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: "The AI interviewer is not enabled for this interview" });
    expect(prisma.aiPracticeSession.create).not.toHaveBeenCalled();
  });

  it("refuses an avatar start when the interview has no questions", async () => {
    interview.questions = [];
    const res = await startAvatar();
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "This interview has no questions yet" });
    interview.questions = null;
    expect((await startAvatar()).status).toBe(409);
    expect(prisma.aiPracticeSession.create).not.toHaveBeenCalled();
  });

  it("refuses an avatar start when the interviewer is in the room", async () => {
    const { app: a, container } = build();
    // The realtime channel counts owner sockets per room in this map.
    container.realtime.roomOwners.set("iv-1", 1);
    const res = await startAvatar(a);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Your interviewer is in the room" });
    expect(prisma.aiPracticeSession.create).not.toHaveBeenCalled();
  });

  it("refuses an avatar start when the avatar service is not configured", async () => {
    const { app: a } = build({ liveAvatar: null });
    const res = await startAvatar(a);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ message: "The avatar is unavailable" });
    expect(prisma.aiPracticeSession.create).not.toHaveBeenCalled();
  });

  it("still starts a text session on an interview without the opt-in", async () => {
    interview.aiInterviewerEnabled = false;
    interview.questions = [];
    const res = await request(app).post(`${AI}/sessions`).send({ language: "python" });
    expect(res.status).toBe(201);
  });

  it("POST /sessions/:sid/avatar-token trades the key for a session token, in the interview's language", async () => {
    const res = await request(app).post(`${AI}/sessions/s1/avatar-token`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionToken: "lat-123", language: "he" });
    const { maxSeconds } = liveAvatar.createSessionToken.mock.calls[0][0];
    expect(liveAvatar.createSessionToken).toHaveBeenCalledWith({ language: "he", maxSeconds: expect.any(Number) });
    expect(maxSeconds).toBeGreaterThan(3500);
    expect(maxSeconds).toBeLessThanOrEqual(3600);
  });

  it("gives at least 60 s to the avatar near the end of the session", async () => {
    stored.startedAt = new Date(Date.now() - (60 * 60 * 1000 - 5000));
    const res = await request(app).post(`${AI}/sessions/s1/avatar-token`);
    expect(res.status).toBe(200);
    expect(liveAvatar.createSessionToken).toHaveBeenCalledWith({ language: "he", maxSeconds: 60 });
  });

  it("caps avatar tokens at 10 per session, atomically", async () => {
    prisma.aiPracticeSession.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post(`${AI}/sessions/s1/avatar-token`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: "Avatar reconnect limit reached" });
    expect(prisma.aiPracticeSession.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "s1", status: "active", avatarTokens: { lt: 10 } }),
      data: { avatarTokens: { increment: 1 } },
    });
    expect(liveAvatar.createSessionToken).not.toHaveBeenCalled();
  });

  it("refuses avatar tokens for a text or finished session", async () => {
    stored.mode = "text";
    const text = await request(app).post(`${AI}/sessions/s1/avatar-token`);
    expect(text.status).toBe(409);
    expect(text.body).toEqual({ message: "Not an avatar session" });
    stored.mode = "avatar";
    stored.status = "finished";
    expect((await request(app).post(`${AI}/sessions/s1/avatar-token`)).status).toBe(409);
    expect(liveAvatar.createSessionToken).not.toHaveBeenCalled();
  });

  it("gives avatar tokens to the invited candidate only", async () => {
    expect((await request(app).post(`${AI}/sessions/s1/avatar-token`).set(authAs(ada))).status).toBe(403);
    expect((await request(app).post(`${AI}/sessions/s1/avatar-token`).set(authAs(bob))).status).toBe(404);
    expect((await request(app).post(`${AI}/sessions/s1/avatar-token`).set(authAs(candidateOf("iv-2")))).status).toBe(404);
    expect((await request(app).post(`${AI}/sessions/s1/avatar-token`).set(authAs(null))).status).toBe(401);
    expect(liveAvatar.createSessionToken).not.toHaveBeenCalled();
  });

  it("a LiveAvatar outage is a 502 with a generic message", async () => {
    const { UpstreamError } = await import("../../shared/errors.js");
    liveAvatar.createSessionToken.mockRejectedValue(new UpstreamError("Avatar service unavailable", { cause: new Error("401 bad key") }));
    const res = await request(app).post(`${AI}/sessions/s1/avatar-token`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: "Avatar service unavailable" });
  });

  it("answers 503 for a token when the avatar service is not configured", async () => {
    const { app: a } = build({ liveAvatar: null });
    const res = await request(a).post(`${AI}/sessions/s1/avatar-token`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ message: "The avatar is unavailable" });
  });

  it("passes the avatar context to the agent and streams the question it presents", async () => {
    practiceInterviewer.streamTurn.mockImplementation(async function* () {
      yield { type: "question", index: 1 };
      yield { type: "question", index: 7 }; // out of range: ignored
      yield { type: "token", text: "Two sum." };
      yield { type: "done", ended: false, limited: false };
    });
    const res = await request(app).post(`${AI}/sessions/s1/messages`).send({ text: "ready", code: "", language: "python" });
    expect(res.status).toBe(200);
    expect(res.text).toBe(
      'event: question\ndata: {"index":1,"text":"Two sum","category":"technical","difficulty":"medium"}\n\n' +
        'event: token\ndata: {"text":"Two sum."}\n\n' +
        'event: done\ndata: {"ended":false,"limited":false}\n\n',
    );
    expect(res.text).not.toContain("src");
    expect(practiceInterviewer.streamTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1", text: "ready", role: "Backend", interviewType: "technical",
        mode: "avatar", company: "Acme", interviewLanguage: "he",
        questions: [
          { text: "Tell me about a conflict", category: "behavioral", difficulty: "easy" },
          { text: "Two sum", category: "technical", difficulty: "medium" },
        ],
      }),
    );
    expect(prisma.aiPracticeSession.update).toHaveBeenCalledTimes(1);
    expect(prisma.aiPracticeSession.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { presentedIndex: 1 }, select: { id: true } });

    const got = await request(app).get(`${AI}/sessions/s1`);
    expect(got.body).toMatchObject({
      mode: "avatar",
      presentedQuestion: { index: 1, text: "Two sum", category: "technical", difficulty: "medium" },
      reportStatus: "none",
    });
    expect(JSON.stringify(got.body)).not.toContain("src");
  });

  it("presentedQuestion is null before any question and the owner still gets the report", async () => {
    const before = await request(app).get(`${AI}/sessions/s1`);
    expect(before.body).toMatchObject({ mode: "avatar", presentedQuestion: null });
    stored.status = "finished";
    stored.report = { summary: "ok" };
    stored.presentedIndex = 0;
    const owner = await request(app).get(`${AI}/sessions/s1`).set(authAs(ada));
    expect(owner.body).toMatchObject({
      mode: "avatar", reportStatus: "ready", report: { summary: "ok" },
      presentedQuestion: { index: 0, text: "Tell me about a conflict", category: "behavioral", difficulty: "easy" },
    });
    expect(JSON.stringify(owner.body)).not.toContain("src");
  });

  it("text sessions report their mode and no presented question", async () => {
    stored.mode = "text";
    const res = await request(app).get(`${AI}/sessions/s1`);
    expect(res.body.mode).toBe("text");
    expect(res.body).not.toHaveProperty("presentedQuestion");
  });
});
