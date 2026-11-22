import { CANDIDATE, DEMO, INTERVIEWER } from "./principal.js";
import { hashInviteSecret } from "./inviteSecrets.js";
import { ConflictError } from "../shared/errors.js";

const CLOSED_STATUSES = new Set(["completed", "cancelled"]);

// Turns credentials into a principal (see principal.js), or null when there is none.
// Order: bearer → demo token (local check) → Clerk session; otherwise invite secret.
export const createIdentityResolver = ({
  clerkVerifier,
  demoTokens,
  userRepository,
  interviewRepository,
}) => {
  // Looked up on every demo request (one indexed upsert): caching the id would go stale
  // when the database is reseeded while the server runs.
  const demoPrincipal = async () => {
    const { id } = await userRepository.upsertDemoUser();
    return { kind: DEMO, userId: id, clerkId: "demo" };
  };

  // A Clerk user may not have a row yet (first visit): create it from Clerk's profile.
  // The dashboard fires several requests at once, so creation can race: a unique-constraint
  // conflict means either a parallel request created the row (re-read it) or the e-mail
  // already belongs to another row (create with the placeholder e-mail instead).
  const provision = async (clerkId) => {
    const { name, email, profileImage } = await clerkVerifier.fetchUser(clerkId);
    const placeholder = `${clerkId}@talentiq.dev`;
    try {
      return await userRepository.createFromClerk({ clerkId, name, email: email || placeholder, profileImage });
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      const raced = await userRepository.findIdentityByClerkId(clerkId);
      if (raced) return raced;
      try {
        return await userRepository.createFromClerk({ clerkId, name, email: placeholder, profileImage });
      } catch (retryErr) {
        // A parallel request won the placeholder create too: its row is the one to use.
        if (!(retryErr instanceof ConflictError)) throw retryErr;
        const winner = await userRepository.findIdentityByClerkId(clerkId);
        if (winner) return winner;
        throw retryErr;
      }
    }
  };

  const interviewerPrincipal = async (clerkId) => {
    const user = (await userRepository.findIdentityByClerkId(clerkId)) ?? (await provision(clerkId));
    return { kind: INTERVIEWER, userId: user.id, clerkId };
  };

  const candidatePrincipal = async (invite) => {
    const interview = await interviewRepository.findByInviteHash(hashInviteSecret(invite));
    if (!interview || CLOSED_STATUSES.has(interview.status)) return null;
    return { kind: CANDIDATE, interviewId: interview.id };
  };

  const fromCredentials = async ({ bearer, invite } = {}) => {
    if (bearer) {
      if (await demoTokens.verify(bearer)) return demoPrincipal();
      const clerk = await clerkVerifier.verify(bearer);
      return clerk ? interviewerPrincipal(clerk.clerkId) : null;
    }
    if (invite) return candidatePrincipal(invite);
    return null;
  };

  const fromRequest = (req) => {
    const auth = req.header("authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
    const invite = req.header("x-invite-token") || undefined;
    return fromCredentials({ bearer, invite });
  };

  return { fromCredentials, fromRequest };
};
