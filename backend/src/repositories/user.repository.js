import { translatePrismaError } from "../shared/prismaErrors.js";

export const USER_SELECT = {
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

const IDENTITY_SELECT = { id: true, name: true, email: true, clerkId: true };

const DEMO_USER = { name: "Demo User", email: "demo@talentiq.dev", clerkId: "demo" };

// Data access for users. The only layer that talks to Prisma.
export const createUserRepository = ({ prisma }) => ({
  findByClerkId: (clerkId) => prisma.user.findUnique({ where: { clerkId }, select: USER_SELECT }),

  findIdentityByClerkId: (clerkId) => prisma.user.findUnique({ where: { clerkId }, select: IDENTITY_SELECT }),

  upsertProfile: (clerkId, { update, create }) =>
    prisma.user.upsert({ where: { clerkId }, update, create, select: USER_SELECT }).catch(translatePrismaError),

  // First visit of a Clerk user: create their row from Clerk's profile.
  createFromClerk: ({ clerkId, name, email, profileImage }) =>
    prisma.user.create({ data: { clerkId, name, email, profileImage }, select: IDENTITY_SELECT }).catch(translatePrismaError),

  // Backs "Guest Mode": the demo account is created on first use.
  upsertDemoUser: () => prisma.user.upsert({ where: { clerkId: "demo" }, update: {}, create: DEMO_USER }),

  countInterviewStats: async (userId) => {
    const mine = { interviewerId: userId };
    const [total, completed, scheduled, cancelled, live, done] = await Promise.all([
      prisma.interview.count({ where: mine }),
      prisma.interview.count({ where: { ...mine, status: "completed" } }),
      prisma.interview.count({ where: { ...mine, status: "scheduled", scheduledAt: { gte: new Date() } } }),
      prisma.interview.count({ where: { ...mine, status: "cancelled" } }),
      prisma.interview.count({ where: { ...mine, status: "live" } }),
      prisma.interview.findMany({ where: { ...mine, status: "completed" }, select: { duration: true } }),
    ]);
    return { total, completed, scheduled, cancelled, live, durations: done.map((i) => i.duration) };
  },
});
