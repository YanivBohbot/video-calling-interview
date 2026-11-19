const TOKEN_TTL_SECONDS = 3600;
// Backdate issuance a little so clocks slightly ahead of ours still accept the token.
const CLOCK_SKEW_SECONDS = 60;

// Issues Stream.io video tokens. `getStreamClient` builds the SDK client lazily, so the
// server boots even when Stream keys are not configured.
export const createStreamService = ({ getStreamClient, now = () => Date.now() }) => ({
  createUserToken: (userId) => {
    const nowSeconds = Math.floor(now() / 1000);
    return getStreamClient().generateUserToken({
      user_id: userId,
      valid_until: nowSeconds + TOKEN_TTL_SECONDS,
      issued_at: nowSeconds - CLOCK_SKEW_SECONDS,
    });
  },
});
