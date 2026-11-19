import { translatePrismaError } from "../shared/prismaErrors.js";

export const INTERVIEWER_SELECT = {
  id: true,
  name: true,
  email: true,
  clerkId: true,
};

// Every scalar on the Interview model EXCEPT `codeSnapshot` and `questions`,
// which list views never render and which can be arbitrarily large.
export const INTERVIEW_LIST_SELECT = {
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

const WITH_INTERVIEWER = { interviewer: { select: INTERVIEWER_SELECT } };

const ACTIVITY_SELECT = {
  id: true,
  candidateName: true,
  role: true,
  status: true,
  scheduledAt: true,
  updatedAt: true,
  interviewType: true,
  interviewer: { select: { name: true } },
};

const notFound = (err) => translatePrismaError(err, { notFoundMessage: "Interview not found" });

// Data access for interviews. The only layer that talks to Prisma.
export const createInterviewRepository = ({ prisma }) => ({
  findMany: (where) =>
    prisma.interview.findMany({ where, orderBy: { scheduledAt: "asc" }, select: INTERVIEW_LIST_SELECT }),

  findById: (id) => prisma.interview.findUnique({ where: { id } }),

  findByIdWithInterviewer: (id) => prisma.interview.findUnique({ where: { id }, include: WITH_INTERVIEWER }),

  findCodeSnapshot: (id) =>
    prisma.interview.findUnique({ where: { id }, select: { codeSnapshot: true, codeLanguage: true } }),

  findByInviteHash: (inviteTokenHash) =>
    prisma.interview.findUnique({ where: { inviteTokenHash }, select: { id: true, status: true } }),

  setInviteHash: (id, inviteTokenHash) =>
    prisma.interview
      .update({ where: { id }, data: { inviteTokenHash, inviteCreatedAt: new Date() }, select: { id: true } })
      .catch(notFound),

  create: (data) => prisma.interview.create({ data, include: WITH_INTERVIEWER }),

  // No include on purpose: this route has always answered with interviewerId as a plain id.
  updateStatus: (id, status) => prisma.interview.update({ where: { id }, data: { status } }).catch(notFound),

  update: (id, data) => prisma.interview.update({ where: { id }, data, include: WITH_INTERVIEWER }).catch(notFound),

  delete: (id) => prisma.interview.delete({ where: { id } }).catch(notFound),

  countDashboardStats: async () => {
    const [total, completed, live, scheduled, cancelled, totalUsers, done] = await Promise.all([
      prisma.interview.count(),
      prisma.interview.count({ where: { status: "completed" } }),
      prisma.interview.count({ where: { status: "live" } }),
      prisma.interview.count({ where: { status: "scheduled" } }),
      prisma.interview.count({ where: { status: "cancelled" } }),
      prisma.user.count(),
      prisma.interview.findMany({ where: { status: "completed" }, select: { duration: true } }),
    ]);
    return { total, completed, live, scheduled, cancelled, totalUsers, durations: done.map((i) => i.duration) };
  },

  findRecent: (take) => prisma.interview.findMany({ orderBy: { updatedAt: "desc" }, take, select: ACTIVITY_SELECT }),
});
