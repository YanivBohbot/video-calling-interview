import { prisma } from "../lib/db.js";
import { leetcodeUrl } from "../lib/agents/questionGenerator/sources.js";

// ── Response helpers ──────────────────────────────────────────────────────────

const toDoc = (record) => {
  if (!record) return null;
  const { id, ...rest } = record;
  return { _id: id, ...rest };
};

const toUserDoc = (user) => {
  if (!user) return null;
  const { id, clerkId, ...rest } = user;
  return { _id: id, clerkID: clerkId, ...rest };
};

export const toInterviewDoc = (iv) => {
  if (!iv) return null;
  const { id, interviewer, interviewerId, ...rest } = iv;
  const doc = { _id: id, ...rest };
  if (interviewer) {
    doc.interviewerId = {
      _id: interviewer.id,
      name: interviewer.name,
      email: interviewer.email,
      clerkID: interviewer.clerkId,
    };
  } else {
    doc.interviewerId = interviewerId;
  }
  return doc;
};

// ── Resolve interviewer by clerkId ────────────────────────────────────────────

export const INTERVIEWER_SELECT = {
  id: true,
  name: true,
  email: true,
  clerkId: true,
};

// Every scalar on the Interview model EXCEPT `codeSnapshot` and `questions`,
// which list views never render and which can be arbitrarily large.
const INTERVIEW_LIST_SELECT = {
  id: true,
  interviewerId: true,
  candidateName: true,
  candidateEmail: true,
  role: true,
  scheduledAt: true,
  status: true,
  duration: true,
  interviewType: true,
  notes: true,
  codeLanguage: true,
  createdAt: true,
  updatedAt: true,
  interviewer: { select: INTERVIEWER_SELECT },
};

const resolveInterviewerId = async (raw) => {
  if (!raw) return null;
  if (raw === "demo") {
    const demo = await prisma.user.upsert({
      where: { clerkId: "demo" },
      update: {},
      create: { name: "Demo User", email: "demo@talentiq.dev", clerkId: "demo" },
    });
    return demo.id;
  }
  const user = await prisma.user.findUnique({ where: { clerkId: raw } });
  return user?.id ?? null;
};

// ── Interviews ────────────────────────────────────────────────────────────────

export const listInterviews = async (req, res) => {
  try {
    const rawInterviewer = req.header("x-clerk-id") || req.query.interviewerId;
    const where = {};
    if (rawInterviewer) {
      const resolved = await resolveInterviewerId(rawInterviewer);
      if (resolved) where.interviewerId = resolved;
      else return res.status(400).json({ message: "Interviewer not found" });
    }
    const interviews = await prisma.interview.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      // Explicit select rather than include: list views never render the code,
      // and `codeSnapshot` can be a large blob. `questions` is excluded for the
      // same reason. Every other scalar the frontend reads stays in the payload.
      select: INTERVIEW_LIST_SELECT,
    });
    return res.status(200).json(interviews.map(toInterviewDoc));
  } catch (error) {
    return res.status(500).json({ message: "Error fetching interviews", error: error.message });
  }
};

export const createInterview = async (req, res) => {
  try {
    const rawInterviewer =
      req.header("x-clerk-id") || req.body.interviewerId || req.body.interviewerClerkId;
    const { candidateName, candidateEmail, role, scheduledAt, duration, interviewType, notes } =
      req.body;

    if (!rawInterviewer || !candidateName || !candidateEmail || !role || !scheduledAt) {
      return res.status(400).json({ message: "Missing required interview fields" });
    }

    const interviewerId = await resolveInterviewerId(rawInterviewer);
    if (!interviewerId) return res.status(400).json({ message: "Interviewer not found" });

    const interview = await prisma.interview.create({
      data: {
        interviewerId,
        candidateName,
        candidateEmail,
        role,
        scheduledAt: new Date(scheduledAt),
        duration: duration || 60,
        interviewType: interviewType || "technical",
        notes: notes || "",
      },
      include: { interviewer: { select: INTERVIEWER_SELECT } },
    });
    return res.status(201).json(toInterviewDoc(interview));
  } catch (error) {
    return res.status(400).json({ message: "Error creating interview", error: error.message });
  }
};

export const getInterview = async (req, res) => {
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: req.params.id },
      include: { interviewer: { select: INTERVIEWER_SELECT } },
    });
    if (!interview) return res.status(404).json({ message: "Interview not found" });
    return res.status(200).json(toInterviewDoc(interview));
  } catch (error) {
    return res.status(500).json({ message: "Error fetching interview", error: error.message });
  }
};

export const updateInterviewStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["scheduled", "live", "completed", "cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });

    const updated = await prisma.interview.update({
      where: { id: req.params.id },
      data: { status },
    });
    return res.status(200).json(toInterviewDoc(updated));
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Interview not found" });
    return res.status(500).json({ message: "Error updating status", error: error.message });
  }
};

export const deleteInterview = async (req, res) => {
  try {
    await prisma.interview.delete({ where: { id: req.params.id } });
    return res.status(200).json({ message: "Interview deleted" });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Interview not found" });
    return res.status(500).json({ message: "Error deleting interview", error: error.message });
  }
};

const ALLOWED_QUESTION_CATEGORY = new Set(["technical", "behavioral", "system-design"]);
const ALLOWED_QUESTION_DIFFICULTY = new Set(["easy", "medium", "hard"]);

const LEETCODE_SLUG = /^[a-z0-9-]+$/;

// A source is rendered as a link, so only a canonical LeetCode problem URL derived
// from a safe slug is accepted — never an arbitrary client-supplied href.
const isValidSource = (s) =>
  !!s &&
  s.type === "leetcode" &&
  typeof s.title === "string" &&
  !!s.title.trim() &&
  typeof s.difficulty === "string" &&
  typeof s.slug === "string" &&
  LEETCODE_SLUG.test(s.slug) &&
  s.url === leetcodeUrl(s.slug);

export const validateQuestionsPayload = (questions) => {
  if (!Array.isArray(questions)) return "questions must be an array";
  for (const q of questions) {
    if (typeof q?.text !== "string" || !q.text.trim()) return "each question needs non-empty text";
    if (!ALLOWED_QUESTION_CATEGORY.has(q.category)) return `invalid category: ${q.category}`;
    if (!ALLOWED_QUESTION_DIFFICULTY.has(q.difficulty)) return `invalid difficulty: ${q.difficulty}`;
    if (q.source !== undefined && !isValidSource(q.source)) return "invalid question source";
  }
  return null;
};

export const updateInterview = async (req, res) => {
  try {
    const { notes, status, questions } = req.body;
    const data = {};
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) {
      const allowed = ["scheduled", "live", "completed", "cancelled"];
      if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });
      data.status = status;
    }
    if (questions !== undefined) {
      const err = validateQuestionsPayload(questions);
      if (err) return res.status(400).json({ message: err });
      data.questions = questions;
    }
    const updated = await prisma.interview.update({
      where: { id: req.params.id },
      data,
      include: { interviewer: { select: INTERVIEWER_SELECT } },
    });
    return res.status(200).json(toInterviewDoc(updated));
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Interview not found" });
    return res.status(500).json({ message: "Error updating interview", error: error.message });
  }
};

// ── Dashboard stats ───────────────────────────────────────────────────────────

export const getInterviewStats = async (req, res) => {
  try {
    const [total, completed, live, scheduled, cancelled, totalUsers, doneInterviews] =
      await Promise.all([
        prisma.interview.count(),
        prisma.interview.count({ where: { status: "completed" } }),
        prisma.interview.count({ where: { status: "live" } }),
        prisma.interview.count({ where: { status: "scheduled" } }),
        prisma.interview.count({ where: { status: "cancelled" } }),
        prisma.user.count(),
        prisma.interview.findMany({
          where: { status: "completed" },
          select: { duration: true },
        }),
      ]);

    const avgDuration = doneInterviews.length
      ? Math.round(
          doneInterviews.reduce((s, i) => s + (i.duration || 60), 0) / doneInterviews.length,
        )
      : 0;

    return res
      .status(200)
      .json({ total, completed, live, scheduled, cancelled, avgDuration, totalUsers });
  } catch (err) {
    return res.status(500).json({ message: "Stats failed", error: err.message });
  }
};

// ── Recent activity feed ──────────────────────────────────────────────────────

export const getRecentActivity = async (req, res) => {
  try {
    const recent = await prisma.interview.findMany({
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        candidateName: true,
        role: true,
        status: true,
        scheduledAt: true,
        updatedAt: true,
        interviewType: true,
        interviewer: { select: { name: true } },
      },
    });

    const activity = recent.map((iv) => ({
      id: iv.id,
      candidateName: iv.candidateName,
      role: iv.role,
      status: iv.status,
      interviewType: iv.interviewType,
      interviewerName: iv.interviewer?.name || "Unknown",
      scheduledAt: iv.scheduledAt,
      updatedAt: iv.updatedAt,
    }));

    return res.status(200).json(activity);
  } catch (err) {
    return res.status(500).json({ message: "Activity failed", error: err.message });
  }
};

export default {
  listInterviews,
  createInterview,
  getInterview,
  updateInterviewStatus,
  updateInterview,
  deleteInterview,
  getInterviewStats,
  getRecentActivity,
};
