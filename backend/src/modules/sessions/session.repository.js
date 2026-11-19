// Data access for coding-problem sessions. The only layer that talks to Prisma.
export const createSessionRepository = ({ prisma }) => ({
  findAll: () =>
    prisma.session.findMany({
      orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }],
    }),

  findById: (id) => prisma.session.findUnique({ where: { id } }),
});
