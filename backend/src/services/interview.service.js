import { NotFoundError, ValidationError } from "../shared/errors.js";
import { averageDuration } from "../shared/stats.js";
import { validateQuestionsPayload } from "../validators/question.validation.js";

const STATUSES = ["scheduled", "live", "completed", "cancelled"];
const RECENT_ACTIVITY_COUNT = 8;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_INTERVIEW_TYPE = "technical";

const assertStatus = (status) => {
  if (!STATUSES.includes(status)) throw new ValidationError("Invalid status");
};

export const createInterviewService = ({ interviewRepository, resolveInterviewerId }) => {
  const requireInterviewerId = async (rawInterviewer) => {
    const interviewerId = await resolveInterviewerId(rawInterviewer);
    if (!interviewerId) throw new ValidationError("Interviewer not found");
    return interviewerId;
  };

  const list = async ({ rawInterviewer } = {}) => {
    const where = rawInterviewer ? { interviewerId: await requireInterviewerId(rawInterviewer) } : {};
    return interviewRepository.findMany(where);
  };

  const create = async ({ rawInterviewer, body = {} }) => {
    const { candidateName, candidateEmail, role, scheduledAt, duration, interviewType, notes } = body;
    if (!rawInterviewer || !candidateName || !candidateEmail || !role || !scheduledAt) {
      throw new ValidationError("Missing required interview fields");
    }
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) throw new ValidationError("Invalid scheduledAt");

    const interviewerId = await requireInterviewerId(rawInterviewer);
    return interviewRepository.create({
      interviewerId,
      candidateName,
      candidateEmail,
      role,
      scheduledAt: date,
      duration: duration || DEFAULT_DURATION_MINUTES,
      interviewType: interviewType || DEFAULT_INTERVIEW_TYPE,
      notes: notes || "",
    });
  };

  const get = async (id) => {
    const interview = await interviewRepository.findByIdWithInterviewer(id);
    if (!interview) throw new NotFoundError("Interview not found");
    return interview;
  };

  const updateStatus = async (id, status) => {
    assertStatus(status);
    return interviewRepository.updateStatus(id, status);
  };

  // Partial update of the interview report (notes / status / saved questions).
  const update = async (id, { notes, status, questions } = {}) => {
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
    return interviewRepository.update(id, data);
  };

  const dashboardStats = async () => {
    const { total, completed, live, scheduled, cancelled, totalUsers, durations } =
      await interviewRepository.countDashboardStats();
    return { total, completed, live, scheduled, cancelled, avgDuration: averageDuration(durations), totalUsers };
  };

  const recentActivity = async () => {
    const recent = await interviewRepository.findRecent(RECENT_ACTIVITY_COUNT);
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

  return {
    list,
    create,
    get,
    updateStatus,
    update,
    remove: (id) => interviewRepository.delete(id),
    dashboardStats,
    recentActivity,
  };
};
