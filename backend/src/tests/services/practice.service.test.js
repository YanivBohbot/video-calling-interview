import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPracticeService } from "../../services/practice.service.js";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const MIN = 60 * 1000;
const PRINCIPAL = { kind: "practice", interviewId: "iv-1" };
const INTERVIEW = { id: "iv-1", role: "Backend", interviewType: "technical", practiceCreatedAt: new Date(NOW - 60 * MIN) };
const active = (startedMinutesAgo = 5, extra = {}) => ({
  id: "s1", interviewId: "iv-1", status: "active", language: "python", code: "x", report: null,
  startedAt: new Date(NOW - startedMinutesAgo * MIN), finishedAt: null, ...extra,
});

let repo;
let interviewer;
let coach;
let limiter;
let background;
let service;

const drain = async (events) => {
  const out = [];
  for await (const event of events) out.push(event);
  return out;
};

beforeEach(() => {
  repo = {
    startExclusive: vi.fn(async ({ interviewId, language }) => ({ session: { ...active(0), interviewId, language }, closedId: null })),
    findById: vi.fn(async () => active()),
    findActive: vi.fn(async () => null),
    countSince: vi.fn(async () => 0),
    claimMessage: vi.fn(async () => true),
    finish: vi.fn(async () => true),
    saveReport: vi.fn(async () => {}),
  };
  interviewer = {
    streamTurn: vi.fn(async function* () {
      yield { type: "token", text: "Hi" };
      yield { type: "done", ended: false, limited: false };
    }),
    history: vi.fn(async () => [{ role: "candidate", text: "hello" }]),
  };
  coach = { review: vi.fn(async () => ({ summary: "ok" })) };
  limiter = { check: vi.fn(() => ({ ok: true })) };
  background = [];
  service = createPracticeService({
    practiceSessionRepository: repo,
    interviewRepository: { findById: vi.fn(async () => INTERVIEW) },
    interviewer,
    coach,
    codeService: { run: vi.fn(async () => ({ output: "1" })) },
    messageLimiter: limiter,
    now: () => NOW,
    runInBackground: (fn) => background.push(fn()),
  });
});

const settle = () => Promise.all(background);

describe("practice service — start", () => {
  it("starts a session atomically with the link's caps", async () => {
    const session = await service.start(PRINCIPAL, { language: "python" });
    expect(repo.startExclusive).toHaveBeenCalledWith({
      interviewId: "iv-1", language: "python", since: INTERVIEW.practiceCreatedAt, max: 3, staleBefore: new Date(NOW - 60 * MIN),
    });
    expect(session.id).toBe("s1");
  });

  it("refuses while another session is active", async () => {
    repo.startExclusive.mockResolvedValue({ conflict: "active" });
    await expect(service.start(PRINCIPAL, { language: "python" })).rejects.toMatchObject({
      status: 409, message: "A practice session is already active",
    });
  });

  it("writes the report of an abandoned session the start closed", async () => {
    repo.startExclusive.mockResolvedValue({ session: active(0, { id: "s2" }), closedId: "s1" });
    await service.start(PRINCIPAL, { language: "python" });
    await settle();
    expect(coach.review).toHaveBeenCalled();
    expect(repo.saveReport).toHaveBeenCalledWith("s1", { summary: "ok" });
  });

  it("refuses a 4th session on the same link", async () => {
    repo.startExclusive.mockResolvedValue({ conflict: "limit", closedId: null });
    await expect(service.start(PRINCIPAL, { language: "python" })).rejects.toMatchObject({ status: 409, message: "Practice limit reached" });
  });
});

describe("practice service — messages", () => {
  const send = () => service.streamMessage(PRINCIPAL, "s1", { text: "hello", code: "print(1)", language: "python" });

  it("claims the message, then streams the interviewer's turn with the code and the role", async () => {
    const events = await drain(await send());
    expect(repo.claimMessage).toHaveBeenCalledWith("s1", { max: 60, code: "print(1)", language: "python" });
    expect(interviewer.streamTurn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", text: "hello", code: "print(1)", language: "python", role: "Backend", interviewType: "technical" }),
    );
    expect(events.at(-1)).toEqual({ type: "done", ended: false, limited: false });
  });

  it("answers 404 for a session of another interview", async () => {
    repo.findById.mockResolvedValue(active(5, { interviewId: "iv-2" }));
    await expect(send()).rejects.toMatchObject({ status: 404 });
  });

  it("answers 409 once the session is finished", async () => {
    repo.findById.mockResolvedValue(active(5, { status: "finished" }));
    await expect(send()).rejects.toMatchObject({ status: 409, message: "Session finished" });
  });

  it("ends the session after 60 minutes", async () => {
    repo.findById.mockResolvedValue(active(60));
    await expect(send()).rejects.toMatchObject({ status: 409, message: "Session time is over" });
    await settle();
    expect(repo.finish).toHaveBeenCalledWith("s1");
  });

  it("rate-limits per link", async () => {
    limiter.check.mockReturnValue({ ok: false, retryAfter: 12 });
    await expect(send()).rejects.toMatchObject({ status: 429 });
    expect(limiter.check).toHaveBeenCalledWith("practice:iv-1");
    expect(repo.claimMessage).not.toHaveBeenCalled();
  });

  it("refuses the 61st message without calling the agent", async () => {
    repo.claimMessage.mockResolvedValue(false);
    await expect(send()).rejects.toMatchObject({ status: 409, message: "Message limit reached" });
    expect(interviewer.streamTurn).not.toHaveBeenCalled();
  });

  it("allows one reply at a time per session (a second message meanwhile gets 409)", async () => {
    let release;
    interviewer.streamTurn.mockImplementationOnce(async function* () {
      await new Promise((resolve) => (release = resolve));
      yield { type: "done", ended: false, limited: false };
    });
    const first = drain(await send());
    await expect(send()).rejects.toMatchObject({ status: 409, message: "A reply is still being written" });
    expect(repo.claimMessage).toHaveBeenCalledTimes(1);
    release();
    await first;
    await expect(drain(await send())).resolves.toBeDefined(); // free again
  });

  it("closes the session even if the candidate disconnects right after end_session", async () => {
    interviewer.streamTurn.mockImplementation(async function* () {
      yield { type: "tool", name: "end_session" };
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await expect(drain(await send())).rejects.toThrow("aborted");
    await settle();
    expect(repo.finish).toHaveBeenCalledWith("s1");
  });

  it("finishes and reports when the agent ends the session", async () => {
    interviewer.streamTurn.mockImplementation(async function* () {
      yield { type: "done", ended: true, limited: false };
    });
    await drain(await send());
    await settle();
    expect(repo.finish).toHaveBeenCalledWith("s1");
    expect(coach.review).toHaveBeenCalledWith({ transcript: [{ role: "candidate", text: "hello" }], code: "x", language: "python" });
    expect(repo.saveReport).toHaveBeenCalledWith("s1", { summary: "ok" });
  });
});

describe("practice service — finish and report", () => {
  it("stores a failed marker when the coach fails", async () => {
    coach.review.mockRejectedValue(new Error("model down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await service.finish(PRINCIPAL, "s1")).toEqual({ status: "finished" });
    await settle();
    expect(repo.saveReport).toHaveBeenCalledWith("s1", { failed: true });
  });

  it("does not report twice when the session was already closed", async () => {
    repo.finish.mockResolvedValue(false);
    await service.finish(PRINCIPAL, "s1");
    await settle();
    expect(coach.review).not.toHaveBeenCalled();
  });

  it("get closes a session past 60 minutes and reports it as finished", async () => {
    repo.findById.mockResolvedValue(active(61));
    const view = await service.get(PRINCIPAL, "s1");
    expect(view).toMatchObject({ status: "finished", reportStatus: "pending" });
    await settle();
    expect(repo.finish).toHaveBeenCalledWith("s1");
  });

  it.each([
    [active(), "none", null],
    [active(5, { status: "finished" }), "pending", null],
    [active(5, { status: "finished", report: { failed: true } }), "failed", null],
    [active(5, { status: "finished", report: { summary: "ok" } }), "ready", { summary: "ok" }],
  ])("get reports the report status (%#)", async (session, reportStatus, report) => {
    repo.findById.mockResolvedValue(session);
    const view = await service.get(PRINCIPAL, "s1");
    expect(view).toMatchObject({ id: "s1", reportStatus, report, messages: [{ role: "candidate", text: "hello" }] });
  });
});
