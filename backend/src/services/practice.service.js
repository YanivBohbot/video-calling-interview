import { ConflictError, NotFoundError, RateLimitError } from "../shared/errors.js";
import { rateKeyFor } from "../shared/rateKeys.js";

// Spec caps (starting values).
export const MAX_SESSIONS_PER_LINK = 3;
export const SESSION_MS = 60 * 60 * 1000;
export const MAX_MESSAGES = 60;

// Practice sessions with the AI interviewer, for a practice-link principal
// ({ kind: "practice", interviewId }). The agents are injected: `interviewer`
// ({ streamTurn, history }) and `coach` ({ review }). The report is written in the
// background once a session ends; `runInBackground` is injectable so tests can await it.
export const createPracticeService = ({
  practiceSessionRepository: sessions,
  interviewRepository,
  interviewer,
  coach,
  codeService,
  messageLimiter,
  now = () => Date.now(),
  runInBackground = (fn) => void fn(),
}) => {
  const notFound = () => new NotFoundError("Practice session not found");
  // Sessions with a turn in progress: two turns at once on one checkpointer thread would
  // both start from the same checkpoint and one exchange would be lost. (Process-local,
  // like the rate limiters.)
  const replying = new Set();
  const isOver = (session) => now() - new Date(session.startedAt).getTime() >= SESSION_MS;

  const loadOwn = async (principal, sessionId) => {
    const session = await sessions.findById(sessionId);
    if (!session || session.interviewId !== principal.interviewId) throw notFound();
    return session;
  };

  const writeReport = async (sessionId) => {
    try {
      const transcript = await interviewer.history(sessionId);
      const { code, language } = await sessions.findById(sessionId);
      const report = await coach.review({ transcript, code: code ?? "", language });
      await sessions.saveReport(sessionId, report);
    } catch (err) {
      console.error("Practice report failed:", err.message);
      await sessions.saveReport(sessionId, { failed: true }).catch(() => {});
    }
  };

  // Closes the session; only the call that actually closed it starts the report.
  const close = async (sessionId) => {
    if (await sessions.finish(sessionId)) runInBackground(() => writeReport(sessionId));
  };

  const start = async (principal, { language }) => {
    const interview = await interviewRepository.findById(principal.interviewId);
    if (!interview) throw notFound();
    const result = await sessions.startExclusive({
      interviewId: principal.interviewId,
      language,
      since: interview.practiceCreatedAt,
      max: MAX_SESSIONS_PER_LINK,
      // An active session older than this was abandoned (tab closed): closed, not blocking.
      staleBefore: new Date(now() - SESSION_MS),
    });
    if (result.closedId) runInBackground(() => writeReport(result.closedId));
    if (result.conflict === "active") throw new ConflictError("A practice session is already active");
    if (result.conflict === "limit") throw new ConflictError("Practice limit reached");
    return result.session;
  };

  const reportStatusOf = (session) => {
    if (session.status === "active") return "none";
    if (!session.report) return "pending";
    return session.report.failed ? "failed" : "ready";
  };

  const get = async (principal, sessionId) => {
    let session = await loadOwn(principal, sessionId);
    if (session.status === "active" && isOver(session)) {
      await close(session.id); // time is up even if the candidate never wrote again
      session = { ...session, status: "finished" };
    }
    const reportStatus = reportStatusOf(session);
    return {
      id: session.id,
      status: session.status,
      language: session.language,
      code: session.code,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      messages: await interviewer.history(session.id),
      reportStatus,
      report: reportStatus === "ready" ? session.report : null,
    };
  };

  // Every refusal is thrown here, before any event: the controller can still answer JSON.
  const streamMessage = async (principal, sessionId, { text, code, language }, signal) => {
    const session = await loadOwn(principal, sessionId);
    if (session.status !== "active") throw new ConflictError("Session finished");
    if (isOver(session)) {
      await close(session.id);
      throw new ConflictError("Session time is over");
    }
    if (replying.has(session.id)) throw new ConflictError("A reply is still being written");
    replying.add(session.id);
    let interview;
    try {
      const gate = messageLimiter.check(rateKeyFor(principal));
      if (!gate.ok) throw new RateLimitError("Too many messages, slow down", gate.retryAfter);
      if (!(await sessions.claimMessage(session.id, { max: MAX_MESSAGES, code, language }))) {
        throw new ConflictError("Message limit reached");
      }
      interview = await interviewRepository.findById(principal.interviewId);
    } catch (err) {
      replying.delete(session.id);
      throw err;
    }

    const turn = interviewer.streamTurn({
      sessionId: session.id,
      text,
      code,
      language,
      role: interview?.role ?? "",
      interviewType: interview?.interviewType ?? "technical",
      signal,
    });
    return (async function* () {
      let ended = false;
      try {
        for await (const event of turn) {
          // Noted at the tool call: the candidate may disconnect during the goodbye.
          if (event.type === "tool" && event.endsSession) ended = true;
          if (event.type === "done" && event.ended) ended = true;
          yield event;
        }
      } finally {
        replying.delete(session.id);
        if (ended) await close(session.id);
      }
    })();
  };

  const finish = async (principal, sessionId) => {
    const session = await loadOwn(principal, sessionId);
    await close(session.id);
    return { status: "finished" };
  };

  const run = (principal, body) => codeService.run(principal, body);

  return { start, get, streamMessage, finish, run };
};
