import { handle } from "../shared/handle.js";

export const createAuthController = ({ demoTokens }) => ({
  // "Continue as Guest": a signed demo token (the demo user row is created on first use).
  demo: handle("Demo login failed", async (req, res) => {
    res.status(200).json(await demoTokens.issue());
  }),
});
