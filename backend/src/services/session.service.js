import { NotFoundError } from "../shared/errors.js";

export const createSessionService = ({ sessionRepository }) => ({
  listSessions: () => sessionRepository.findAll(),

  getSession: async (id) => {
    const session = await sessionRepository.findById(id);
    if (!session) throw new NotFoundError("Session not found");
    return session;
  },
});
