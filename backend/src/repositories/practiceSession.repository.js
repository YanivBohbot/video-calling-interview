// Data access for AI practice sessions (table ai_practice_sessions). The conversation
// itself is in the LangGraph checkpointer; this row holds status, counters, code and report.
import { Prisma } from "@prisma/client";

export const createPracticeSessionRepository = ({ prisma }) => {
  const sessions = prisma.aiPracticeSession;
  return {
    findById: (id) => sessions.findUnique({ where: { id } }),

    // The interview's most recent session, active or finished (a reloaded room shows it).
    findLatest: (interviewId) => sessions.findFirst({ where: { interviewId }, orderBy: { startedAt: "desc" } }),

    // Starts a session if the link allows it, atomically: a per-interview advisory lock
    // serialises concurrent starts, so N parallel requests can't all see "no active session,
    // fewer than `max` used". An active session started before `staleBefore` is abandoned:
    // it is closed here and its id returned (`closedId`) so the caller writes its report.
    // → { session, closedId } | { conflict: "active" } | { conflict: "limit", closedId }
    startExclusive: ({ interviewId, language, max, staleBefore }) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${interviewId}))`;
        const rows = tx.aiPracticeSession;
        let closedId = null;
        const current = await rows.findFirst({ where: { interviewId, status: "active" } });
        if (current) {
          if (new Date(current.startedAt) > staleBefore) return { conflict: "active" };
          await rows.update({ where: { id: current.id }, data: { status: "finished", finishedAt: new Date() } });
          closedId = current.id;
        }
        const used = await rows.count({ where: { interviewId } });
        if (used >= max) return { conflict: "limit", closedId };
        return { session: await rows.create({ data: { interviewId, language } }), closedId };
      }),

    // Clears a failed report so it can be written again. True only for the call that
    // cleared it (two clicks at once start one report).
    claimReportRetry: async (id) => {
      const { count } = await sessions.updateMany({
        where: { id, status: "finished", report: { equals: { failed: true } } },
        data: { report: Prisma.DbNull },
      });
      return count === 1;
    },

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
