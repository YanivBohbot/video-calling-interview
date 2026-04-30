import { prisma } from "../lib/db.js";

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

const toInterviewDoc = (iv) => {
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

const INTERVIEWER_SELECT = {
  id: true,
  name: true,
  email: true,
  clerkId: true,
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
      include: { interviewer: { select: INTERVIEWER_SELECT } },
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

// ── Users ─────────────────────────────────────────────────────────────────────

const USER_SELECT = {
  id: true,
  clerkId: true,
  name: true,
  email: true,
  profileImage: true,
  title: true,
  bio: true,
  phone: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
};

export const createUser = async (req, res) => {
  try {
    const { name, email, clerkID, profileImage } = req.body;
    if (!name || !email || !clerkID)
      return res.status(400).json({ message: "Missing required user fields" });

    const user = await prisma.user.create({
      data: { name, email, clerkId: clerkID, profileImage },
      select: USER_SELECT,
    });
    return res.status(201).json(toUserDoc(user));
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ message: "User exists" });
    return res.status(500).json({ message: "Create user failed", error: err.message });
  }
};

export const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: USER_SELECT,
    });
    return res.status(200).json(users.map(toUserDoc));
  } catch (err) {
    return res.status(500).json({ message: "Fetch users failed", error: err.message });
  }
};

export const getUserByClerkId = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { clerkId: req.params.clerkId },
      select: USER_SELECT,
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json(toUserDoc(user));
  } catch (err) {
    return res.status(500).json({ message: "Fetch user failed", error: err.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { clerkId } = req.params;
    const { name, email, title, bio, phone, timezone, profileImage } = req.body;

    if (!name) return res.status(400).json({ message: "Name is required" });

    const user = await prisma.user.upsert({
      where: { clerkId },
      update: {
        name,
        title: title || "",
        bio: bio || "",
        phone: phone || "",
        timezone: timezone || "UTC",
        ...(profileImage && { profileImage }),
      },
      create: {
        clerkId,
        name,
        email: email || `${clerkId}@talentiq.dev`,
        title: title || "",
        bio: bio || "",
        phone: phone || "",
        timezone: timezone || "UTC",
        ...(profileImage && { profileImage }),
      },
      select: USER_SELECT,
    });
    return res.status(200).json(toUserDoc(user));
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ message: "Email already in use" });
    return res.status(400).json({ message: "Update failed", error: err.message });
  }
};

export const getUserStats = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { clerkId: req.params.clerkId } });
    if (!user)
      return res
        .status(200)
        .json({ total: 0, completed: 0, scheduled: 0, cancelled: 0, live: 0, avgDuration: 0 });

    const [total, completed, scheduled, cancelled, live, doneInterviews] = await Promise.all([
      prisma.interview.count({ where: { interviewerId: user.id } }),
      prisma.interview.count({ where: { interviewerId: user.id, status: "completed" } }),
      prisma.interview.count({
        where: {
          interviewerId: user.id,
          status: "scheduled",
          scheduledAt: { gte: new Date() },
        },
      }),
      prisma.interview.count({ where: { interviewerId: user.id, status: "cancelled" } }),
      prisma.interview.count({ where: { interviewerId: user.id, status: "live" } }),
      prisma.interview.findMany({
        where: { interviewerId: user.id, status: "completed" },
        select: { duration: true },
      }),
    ]);

    const avgDuration = doneInterviews.length
      ? Math.round(
          doneInterviews.reduce((s, i) => s + (i.duration || 60), 0) / doneInterviews.length,
        )
      : 0;

    return res.status(200).json({ total, completed, scheduled, cancelled, live, avgDuration });
  } catch (err) {
    return res.status(500).json({ message: "Stats failed", error: err.message });
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

// ── Sessions (coding problems) ────────────────────────────────────────────────

export const listSessions = async (req, res) => {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }],
    });
    return res.status(200).json(sessions.map(toDoc));
  } catch (err) {
    return res.status(500).json({ message: "Fetch sessions failed", error: err.message });
  }
};

export const getSession = async (req, res) => {
  try {
    const session = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (!session) return res.status(404).json({ message: "Session not found" });
    return res.status(200).json(toDoc(session));
  } catch (err) {
    return res.status(500).json({ message: "Fetch session failed", error: err.message });
  }
};

export default {
  listInterviews,
  createInterview,
  getInterview,
  updateInterviewStatus,
  deleteInterview,
  createUser,
  getUsers,
  getUserByClerkId,
  updateUser,
  getUserStats,
  getInterviewStats,
  getRecentActivity,
  listSessions,
  getSession,
};
