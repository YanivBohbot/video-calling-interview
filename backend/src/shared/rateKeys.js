import { CANDIDATE } from "../auth/principal.js";

// The rate-limit key of a caller: an interviewer (or the shared demo account) by user,
// an invited candidate by interview.
export const rateKeyFor = (principal) => {
  if (principal.kind === CANDIDATE) return `candidate:${principal.interviewId}`;
  return `user:${principal.userId}`;
};
