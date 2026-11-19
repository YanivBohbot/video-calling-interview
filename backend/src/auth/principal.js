// Who is calling. Every authenticated request / socket carries exactly one principal:
//   { kind: "interviewer", userId, clerkId }          — verified Clerk session
//   { kind: "demo",        userId, clerkId: "demo" }  — verified demo token ("Continue as Guest")
//   { kind: "candidate",   interviewId }              — verified invite link, scoped to one interview
export const INTERVIEWER = "interviewer";
export const DEMO = "demo";
export const CANDIDATE = "candidate";

// Interviewers and demo visitors own interviews; candidates never do.
export const isOwnerKind = (principal) => principal?.kind === INTERVIEWER || principal?.kind === DEMO;
