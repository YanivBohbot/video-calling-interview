import { CANDIDATE, DEMO, INTERVIEWER } from "./principal.js";
import { hashInviteSecret } from "./inviteSecrets.js";

const CLOSED_STATUSES = new Set(["completed", "cancelled"]);

// Turns credentials into a principal (see principal.js), or null when there is none.
// Order: bearer → demo token (local check) → Clerk session; otherwise invite secret.
export const createIdentityResolver = ({ clerkVerifier, demoTokens, userRepository, interviewRepository }) => {
  let demoUserId; // the demo row never changes once created

  const demoPrincipal = async () => {
    demoUserId ??= (await userRepository.upsertDemoUser()).id;
    return { kind: DEMO, userId: demoUserId, clerkId: "demo" };
  };

  // A Clerk user may not have a row yet (first visit): create it from Clerk's profile.
  const interviewerPrincipal = async (clerkId) => {
    let user = await userRepository.findIdentityByClerkId(clerkId);
    if (!user) {
      const { name, email, profileImage } = await clerkVerifier.fetchUser(clerkId);
      user = await userRepository.createFromClerk({
        clerkId,
        name,
        email: email || `${clerkId}@talentiq.dev`,
        profileImage,
      });
    }
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
