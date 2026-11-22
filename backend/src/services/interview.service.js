import { AppError, NotFoundError, ValidationError } from "../shared/errors.js";
import { averageDuration } from "../shared/stats.js";
import { validateQuestionsPayload } from "../validators/question.validation.js";
import { generateInviteSecret } from "../auth/inviteSecrets.js";
import { CANDIDATE, DEMO } from "../auth/principal.js";

const STATUSES = ["scheduled", "live", "completed", "cancelled"];
const RECENT_ACTIVITY_COUNT = 8;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_INTERVIEW_TYPE = "technical";

const assertStatus = (status) => {
  if (!STATUSES.includes(status)) throw new ValidationError("Invalid status");
};

// Every method takes the caller (principal) first. Interviewers and the demo visitor
// only ever see their own interviews: anything else is "not found", so ids can't be probed.
export const createInterviewService = ({ interviewRepository, practiceSessionRepository, clientUrl }) => {
  const notFound = () => new NotFoundError("Interview not found");

  const isOwner = (principal, interview) => !!interview && interview.interviewerId === principal.userId;

  // Loads an interview the caller owns (with its interviewer), or throws 404.
  const getOwned = async (principal, id) => {
    const interview = await interviewRepository.findByIdWithInterviewer(id);
    if (!isOwner(principal, interview)) throw notFound();
    return interview;
  };

  const assertOwned = async (principal, id) => {
    if (!isOwner(principal, await interviewRepository.findById(id))) throw notFound();
  };

  const list = (principal) => interviewRepository.findMany({ interviewerId: principal.userId });

  const create = async (principal, body = {}) => {
    const { candidateName, candidateEmail, role, scheduledAt, duration, interviewType, notes } = body;
    if (!candidateName || !candidateEmail || !role || !scheduledAt) {
      throw new ValidationError("Missing required interview fields");
    }
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) throw new ValidationError("Invalid scheduledAt");

    return interviewRepository.create({
      interviewerId: principal.userId,
      candidateName,
      candidateEmail,
      role,
      scheduledAt: date,
      duration: duration || DEFAULT_DURATION_MINUTES,
      interviewType: interviewType || DEFAULT_INTERVIEW_TYPE,
      notes: notes || "",
    });
  };

  const updateStatus = async (principal, id, status) => {
    assertStatus(status);
    await assertOwned(principal, id);
    return interviewRepository.updateStatus(id, status);
  };

  // Partial update of the interview report (notes / status / saved questions).
  const update = async (principal, id, { notes, status, questions } = {}) => {
    const data = {};
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) {
      assertStatus(status);
      data.status = status;
    }
    if (questions !== undefined) {
      const problem = validateQuestionsPayload(questions);
      if (problem) throw new ValidationError(problem);
      data.questions = questions;
    }
    await assertOwned(principal, id);
    return interviewRepository.update(id, data);
  };

  // Demo visitors can't delete: the demo data is the showcase.
  const remove = async (principal, id) => {
    if (principal.kind === DEMO) throw new AppError(403, "Not allowed in demo mode");
    await assertOwned(principal, id);
    return interviewRepository.delete(id);
  };

  const dashboardStats = async (principal) => {
    const { total, completed, live, scheduled, cancelled, durations } =
      await interviewRepository.countDashboardStats(principal.userId);
    return { total, completed, live, scheduled, cancelled, avgDuration: averageDuration(durations) };
  };

  const recentActivity = async (principal) => {
    const recent = await interviewRepository.findRecent(RECENT_ACTIVITY_COUNT, principal.userId);
    return recent.map((iv) => ({
      id: iv.id,
      candidateName: iv.candidateName,
      role: iv.role,
      status: iv.status,
      interviewType: iv.interviewType,
      interviewerName: iv.interviewer?.name || "Unknown",
      scheduledAt: iv.scheduledAt,
      updatedAt: iv.updatedAt,
    }));
  };

  // New candidate link; replaces (and so revokes) any previous one. Only the hash is stored.
  const createInvite = async (principal, id) => {
    await assertOwned(principal, id);
    const { secret, hash } = generateInviteSecret();
    await interviewRepository.setInviteHash(id, hash);
    return { url: `${clientUrl}/room/${encodeURIComponent(id)}#invite=${secret}` };
  };

  // New AI practice link (candidate-only); replaces any previous one. Only the hash is stored.
  const createPracticeLink = async (principal, id) => {
    await assertOwned(principal, id);
    const { secret, hash } = generateInviteSecret();
    await interviewRepository.setPracticeHash(id, hash);
    return { url: `${clientUrl}/practice/${encodeURIComponent(id)}#practice=${secret}` };
  };

  // What the interviewer may know about practice: when the link was made and when it was
  // used. Never the messages, the code or the report (those are the candidate's).
  const practiceUsage = async (principal, id) => {
    const interview = await interviewRepository.findById(id);
    if (!isOwner(principal, interview)) throw notFound();
    const sessions = await practiceSessionRepository.listForInterview(id);
    return {
      createdAt: interview.practiceCreatedAt ?? null,
      sessions: sessions.map(({ status, startedAt, finishedAt }) => ({ status, startedAt, finishedAt })),
    };
  };

  // The room page: owners get the full interview, the invited candidate a reduced view.
  const roomView = async (principal, id) => {
    if (principal.kind === CANDIDATE) {
      if (principal.interviewId !== id) throw notFound();
      const interview = await interviewRepository.findById(id);
      if (!interview) throw notFound();
      return { viewer: "candidate", interview };
    }
    return { viewer: "owner", interview: await getOwned(principal, id) };
  };

  return {
    list,
    create,
    get: getOwned,
    updateStatus,
    update,
    remove,
    dashboardStats,
    recentActivity,
    createInvite,
    createPracticeLink,
    practiceUsage,
    roomView,
  };
};
