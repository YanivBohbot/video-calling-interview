import { CodeRunnerUnavailableError } from "../integrations/piston/client.js";
import { RateLimitError, UpstreamError } from "../shared/errors.js";
import { rateKeyFor } from "../shared/rateKeys.js";

// Runs code for the editor's Run button through the self-hosted Piston.
// Each caller has their own budget (see shared/rateKeys.js).
export const createCodeService = ({ codeRunner, rateLimiter }) => ({
  run: async (principal, { language, code, stdin }) => {
    const gate = rateLimiter.check(rateKeyFor(principal));
    if (!gate.ok) throw new RateLimitError("Too many runs, slow down", gate.retryAfter);
    try {
      return await codeRunner.runCode({ language, code, stdin });
    } catch (err) {
      if (err instanceof CodeRunnerUnavailableError) throw new UpstreamError("Code runner unavailable", { cause: err });
      throw err;
    }
  },
});
