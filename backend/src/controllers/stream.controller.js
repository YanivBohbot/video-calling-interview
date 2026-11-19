import { handle } from "../shared/handle.js";

export const createStreamController = ({ streamService }) => ({
  // Any principal (interviewer, demo, candidate) may join the video call.
  token: handle("Internal server error", async (req, res) => {
    res.status(200).json(streamService.createUserToken(req.principal));
  }),
});
