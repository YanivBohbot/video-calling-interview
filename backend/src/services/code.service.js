import { CANDIDATE } from "../auth/principal.js";
import { CodeRunnerUnavailableError } from "../integrations/piston/client.js";
import { RateLimitError, UpstreamError } from "../shared/errors.js";

// Each caller has their own budget: an interviewer (or the shared demo account) by user,
// an invited candidate by interview.
const rateKeyFor = (principal) =>
  principal.kind === CANDIDATE ? `candidate:${principal.interviewId}` : `user:${principal.userId}`;

// Runs code for the editor's Run button through the self-hosted Piston.
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
