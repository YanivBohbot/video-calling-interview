// Data access for AI practice sessions (table ai_practice_sessions). The conversation
// itself is in the LangGraph checkpointer; this row holds status, counters, code and report.
const USAGE_SELECT = { id: true, status: true, startedAt: true, finishedAt: true };

export const createPracticeSessionRepository = ({ prisma }) => {
  const sessions = prisma.aiPracticeSession;
  return {
    create: ({ interviewId, language }) => sessions.create({ data: { interviewId, language } }),

    findById: (id) => sessions.findUnique({ where: { id } }),

    findActive: (interviewId) => sessions.findFirst({ where: { interviewId, status: "active" } }),

    countSince: (interviewId, since) => sessions.count({ where: { interviewId, startedAt: { gte: since } } }),

    // What the interviewer may see: dates and status only, never code, messages or report.
    listForInterview: (interviewId) =>
      sessions.findMany({ where: { interviewId }, orderBy: { startedAt: "desc" }, select: USAGE_SELECT }),

    // One atomic update, so two messages sent at once can't both pass the cap.
    claimMessage: async (id, { max, code, language }) => {
      const { count } = await sessions.updateMany({
        where: { id, status: "active", messageCount: { lt: max } },
        data: { messageCount: { increment: 1 }, code, language },
      });
      return count === 1;
    },

    // True only for the call that actually closed the session (so the report runs once).
    finish: async (id) => {
      const { count } = await sessions.updateMany({
        where: { id, status: "active" },
        data: { status: "finished", finishedAt: new Date() },
      });
      return count === 1;
    },

    saveReport: async (id, report) => {
      await sessions.update({ where: { id }, data: { report }, select: { id: true } });
    },
  };
};
