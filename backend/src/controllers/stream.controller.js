import { handle } from "../shared/handle.js";
import { ValidationError } from "../shared/errors.js";

export const createStreamController = ({ streamService }) => ({
  token: handle("Internal server error", async (req, res) => {
    const { userId } = req.query;
    if (!userId) throw new ValidationError("User ID is required");
    res.status(200).json({ token: streamService.createUserToken(userId) });
  }),
});
