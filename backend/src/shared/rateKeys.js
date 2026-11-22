import { CANDIDATE, PRACTICE } from "../auth/principal.js";

// The rate-limit key of a caller: an interviewer (or the shared demo account) by user,
// an invited candidate or a practice link by interview.
export const rateKeyFor = (principal) => {
  if (principal.kind === CANDIDATE) return `candidate:${principal.interviewId}`;
  if (principal.kind === PRACTICE) return `practice:${principal.interviewId}`;
  return `user:${principal.userId}`;
};
