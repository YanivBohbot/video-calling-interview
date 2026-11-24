import { AppError, ConflictError, NotFoundError, RateLimitError } from "../shared/errors.js";
import { CANDIDATE } from "../auth/principal.js";

// Caps. One AI interview per interview: the candidate is evaluated once, and never sees
// the report (it is the interviewer's), so there is nothing to retry their way.
export const MAX_SESSIONS_PER_INTERVIEW = 1;
export const SESSION_MS = 60 * 60 * 1000;
export const MAX_MESSAGES = 60;
// Avatar reconnects (a new LiveAvatar token for the same session) and the shortest avatar session.
export const MAX_AVATAR_TOKENS = 10;
const MIN_AVATAR_SECONDS = 60;

// The AI interviewer of an interview room. The invited candidate of the interview talks to
// it; the interview's owner follows the conversation and alone reads the report. Anyone
// else gets 404. The agents are injected: `interviewer` ({ streamTurn, history }) and `coach`
// ({ review }). `askedQuestionOf(interviewId)`: the question the interviewer put on screen
// in the room (realtime), if any. The report is written in the background once a session ends;
// `runInBackground` is injectable so tests can await it.
// Avatar mode: the candidate runs the whole interview with a LiveAvatar avatar voicing the agent.
// `isInterviewerPresent(interviewId)` (realtime) gates its start; `liveAvatar`
// ({ createSessionToken }) trades the server-side key for a browser token, null when not configured.
export const createPracticeService = ({
  practiceSessionRepository: sessions,
  interviewRepository,
  interviewer,
  coach,
  messageLimiter,
  askedQuestionOf = () => undefined,
  isInterviewerPresent = () => false,
  liveAvatar = null,
  now = () => Date.now(),
  runInBackground = (fn) => void fn(),
}) => {
  const notFound = () => new NotFoundError("Not found");
  // Sessions with a turn in progress: two turns at once on one checkpointer thread would
  // both start from the same checkpoint and one exchange would be lost. (Process-local,
  // like the rate limiters.)
  const replying = new Set();
  // The question each session's last turn was about, so the turn where the interviewer
  // switched to another one is flagged to the agent (process-local, like `replying`).
  const lastQuestion = new Map();
  const isOver = (session) => now() - new Date(session.startedAt).getTime() >= SESSION_MS;

  // The interview, if the caller may see its AI: its invited candidate or its owner.
  // `write` (start, send) is the candidate's alone.
  // `ownerOnly` (the report) is the interviewer's alone.
  // `candidateOnly` (avatar tokens) refuses the owner with a plain Forbidden.
  const loadInterview = async (principal, interviewId, { write = false, ownerOnly = false, candidateOnly = false } = {}) => {
    const isCandidate = principal.kind === CANDIDATE;
    if (isCandidate && principal.interviewId !== interviewId) throw notFound();
    const interview = await interviewRepository.findById(interviewId);
    if (!interview || (!isCandidate && interview.interviewerId !== principal.userId)) throw notFound();
    if (write && !isCandidate) throw new AppError(403, "Only the candidate talks to the AI interviewer");
    if (ownerOnly && isCandidate) throw new AppError(403, "Forbidden");
    if (candidateOnly && !isCandidate) throw new AppError(403, "Forbidden");
    return interview;
  };

  const loadSession = async (principal, interviewId, sessionId, options) => {
    const interview = await loadInterview(principal, interviewId, options);
    const session = await sessions.findById(sessionId);
    if (!session || session.interviewId !== interviewId) throw notFound();
    return { interview, session };
  };

  // The question the AI interviewer asks: the one on screen (Ask), else the interview's first
  // technical question, else none (the agent finds a problem). Never its LeetCode source.
  const questionFor = (interview) => {
    const pick =
      askedQuestionOf(interview.id) ??
      (Array.isArray(interview.questions) ? interview.questions : []).find((q) => q?.category === "technical");
    return pick ? { text: pick.text, category: pick.category, difficulty: pick.difficulty } : null;
  };

  // The interview's questions as the agent may see them: never their LeetCode source. The
  // agent's `present_question` index points into this array, so nothing is filtered out.
  const questionsOf = (interview) =>
    (Array.isArray(interview.questions) ? interview.questions : []).map((q) => ({
      text: q?.text,
      category: q?.category,
      difficulty: q?.difficulty,
    }));
  // The question at `index`, as shown to the candidate; null when out of range.
  const presentedAt = (interview, index) => {
    const questions = questionsOf(interview);
    if (!Number.isInteger(index) || index < 0 || index >= questions.length) return null;
    return { index, ...questions[index] };
  };
  const avatarUnavailable = () => new AppError(503, "The avatar is unavailable");

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

  // Avatar refusals come before the session is created: a refused start must not use up the
  // interview's one session.
  const checkAvatarStart = (interview) => {
    if (!interview.aiInterviewerEnabled) throw new AppError(403, "The AI interviewer is not enabled for this interview");
    if (!Array.isArray(interview.questions) || interview.questions.length === 0) {
      throw new ConflictError("This interview has no questions yet");
    }
    if (isInterviewerPresent(interview.id)) throw new ConflictError("Your interviewer is in the room");
    if (!liveAvatar) throw avatarUnavailable();
  };

  const start = async (principal, interviewId, { language, mode = "text" }) => {
    const interview = await loadInterview(principal, interviewId, { write: true });
    if (mode === "avatar") checkAvatarStart(interview);
    const result = await sessions.startExclusive({
      interviewId,
      language,
      mode,
      max: MAX_SESSIONS_PER_INTERVIEW,
      // An active session older than this was abandoned (tab closed): closed, not blocking.
      staleBefore: new Date(now() - SESSION_MS),
    });
    if (result.closedId) runInBackground(() => writeReport(result.closedId));
    if (result.conflict === "active") throw new ConflictError("An AI interviewer session is already active");
    if (result.conflict === "limit") throw new ConflictError("The AI interview of this interview has already taken place");
    return result.session;
  };

  // The interview's latest session (active or finished), so a reloaded room finds the
  // conversation and its report again. An active one past its time is closed on the way.
  const current = async (principal, interviewId) => {
    await loadInterview(principal, interviewId);
    const session = await sessions.findLatest(interviewId);
    if (!session) return { sessionId: null };
    if (session.status === "active" && isOver(session)) await close(session.id);
    return { sessionId: session.id };
  };

  const reportStatusOf = (session) => {
    if (session.status === "active") return "none";
    if (!session.report) return "pending";
    return session.report.failed ? "failed" : "ready";
  };

  const get = async (principal, interviewId, sessionId) => {
    let { interview, session } = await loadSession(principal, interviewId, sessionId);
    if (session.status === "active" && isOver(session)) {
      await close(session.id); // time is up even if the candidate never wrote again
      session = { ...session, status: "finished" };
    }
    // The candidate learns the session is over, nothing about the report.
    const reportStatus = principal.kind === CANDIDATE ? "none" : reportStatusOf(session);
    return {
      id: session.id,
      status: session.status,
      language: session.language,
      mode: session.mode,
      ...(session.mode === "avatar" && { presentedQuestion: presentedAt(interview, session.presentedIndex) }),
      code: session.code,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      messages: await interviewer.history(session.id),
      reportStatus,
      report: reportStatus === "ready" ? session.report : null,
    };
  };

  // Every refusal is thrown here, before any event: the controller can still answer JSON.
  const streamMessage = async (principal, interviewId, sessionId, { text, code, language }, signal) => {
    const { interview, session } = await loadSession(principal, interviewId, sessionId, { write: true });
    if (session.status !== "active") throw new ConflictError("Session finished");
    if (isOver(session)) {
      await close(session.id);
      throw new ConflictError("Session time is over");
    }
    if (replying.has(session.id)) throw new ConflictError("A reply is still being written");
    replying.add(session.id);
    try {
      const gate = messageLimiter.check(`ai:${interviewId}`);
      if (!gate.ok) throw new RateLimitError("Too many messages, slow down", gate.retryAfter);
      if (!(await sessions.claimMessage(session.id, { max: MAX_MESSAGES, code, language }))) {
        throw new ConflictError("Message limit reached");
      }
    } catch (err) {
      replying.delete(session.id);
      throw err;
    }

    const question = questionFor(interview);
    const questionText = question?.text ?? null;
    const questionChanged = lastQuestion.has(session.id) && lastQuestion.get(session.id) !== questionText;
    lastQuestion.set(session.id, questionText);

    const turn = interviewer.streamTurn({
      sessionId: session.id,
      text,
      code,
      language,
      role: interview.role ?? "",
      interviewType: interview.interviewType ?? "technical",
      question,
      questionChanged,
      mode: session.mode,
      company: interview.company ?? "",
      interviewLanguage: interview.interviewLanguage ?? "en",
      questions: questionsOf(interview),
      signal,
    });
    return (async function* () {
      let ended = false;
      try {
        for await (const event of turn) {
          // Noted at the tool call: the candidate may disconnect during the goodbye.
          if (event.type === "tool" && event.endsSession) ended = true;
          if (event.type === "done" && event.ended) ended = true;
          // The avatar interviewer moved to another question: remembered, and shown on screen.
          if (event.type === "question") {
            const question = presentedAt(interview, event.index);
            if (!question) continue;
            await sessions.savePresentedIndex(session.id, question.index);
            yield { type: "question", question };
            continue;
          }
          yield event;
        }
      } finally {
        replying.delete(session.id);
        if (ended) await close(session.id);
      }
    })();
  };

  // A report that failed (model down, timeout…) can be written again, by the interviewer.
  const retryReport = async (principal, interviewId, sessionId) => {
    const { session } = await loadSession(principal, interviewId, sessionId, { ownerOnly: true });
    if (!(await sessions.claimReportRetry(session.id))) throw new ConflictError("There is no failed report to retry");
    runInBackground(() => writeReport(session.id));
    return { reportStatus: "pending" };
  };

  // A LiveAvatar session token for the candidate's active avatar session (also to reconnect a
  // dropped avatar: the owner-presence check is only at start). The API key stays here.
  const avatarToken = async (principal, interviewId, sessionId) => {
    const { interview, session } = await loadSession(principal, interviewId, sessionId, { candidateOnly: true });
    if (!interview.aiInterviewerEnabled) throw new AppError(403, "The AI interviewer is not enabled for this interview");
    if (session.status !== "active" || session.mode !== "avatar") throw new ConflictError("Not an avatar session");
    if (isOver(session)) {
      await close(session.id);
      throw new ConflictError("Session time is over");
    }
    if (!liveAvatar) throw avatarUnavailable();
    if (!(await sessions.claimAvatarToken(session.id, { max: MAX_AVATAR_TOKENS }))) {
      throw new ConflictError("Avatar reconnect limit reached");
    }
    const remainingMs = SESSION_MS - (now() - new Date(session.startedAt).getTime());
    const language = interview.interviewLanguage ?? "en";
    const { sessionToken } = await liveAvatar.createSessionToken({
      language,
      maxSeconds: Math.max(MIN_AVATAR_SECONDS, Math.floor(remainingMs / 1000)),
    });
    return { sessionToken, language };
  };

  // The candidate or the owner may end the session.
  const finish = async (principal, interviewId, sessionId) => {
    const { session } = await loadSession(principal, interviewId, sessionId);
    await close(session.id);
    return { status: "finished" };
  };

  return { start, current, get, streamMessage, finish, retryReport, avatarToken };
};
