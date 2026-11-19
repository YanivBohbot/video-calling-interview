import { handle } from "../../shared/handle.js";
import { toDoc } from "../../shared/mongoShape.js";

export const createSessionController = ({ sessionService }) => ({
  list: handle("Fetch sessions failed", async (req, res) => {
    const sessions = await sessionService.listSessions();
    res.status(200).json(sessions.map(toDoc));
  }),

  get: handle("Fetch session failed", async (req, res) => {
    const session = await sessionService.getSession(req.params.id);
    res.status(200).json(toDoc(session));
  }),
});
