import { handle } from "../shared/handle.js";

export const createCodeController = ({ codeService }) => ({
  // Any principal (interviewer, demo, candidate) may run code.
  run: handle("Failed to run code", async (req, res) => {
    res.status(200).json(await codeService.run(req.principal, req.body));
  }),
});
