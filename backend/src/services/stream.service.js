import crypto from "node:crypto";
import { CANDIDATE, DEMO } from "../auth/principal.js";

const TOKEN_TTL_SECONDS = 3600;
// Backdate issuance a little so clocks slightly ahead of ours still accept the token.
const CLOCK_SKEW_SECONDS = 60;

const randomSuffix = () => crypto.randomBytes(4).toString("hex");

// The Stream user id comes from the verified caller, never from the request:
// interviewers use their Clerk id; demo visitors and candidates get a fresh id each time.
const streamUserIdFor = (principal) => {
  if (principal.kind === CANDIDATE) return `candidate-${principal.interviewId}-${randomSuffix()}`;
  if (principal.kind === DEMO) return `demo-${randomSuffix()}`;
  return principal.clerkId;
};

// Issues Stream.io video tokens. `getStreamClient` builds the SDK client lazily, so the
// server boots even when Stream keys are not configured.
export const createStreamService = ({ getStreamClient, now = () => Date.now() }) => ({
  createUserToken: (principal) => {
    const userId = streamUserIdFor(principal);
    const nowSeconds = Math.floor(now() / 1000);
    const token = getStreamClient().generateUserToken({
      user_id: userId,
      valid_until: nowSeconds + TOKEN_TTL_SECONDS,
      issued_at: nowSeconds - CLOCK_SKEW_SECONDS,
    });
    return { token, userId };
  },
});
