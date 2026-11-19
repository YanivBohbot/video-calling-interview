import { CANDIDATE, isOwnerKind } from "../auth/principal.js";

// Which Socket.io rooms (one per interview) a principal may join.
export const createRoomAccess = ({ interviewRepository }) => async (principal, roomId) => {
  if (principal?.kind === CANDIDATE) return principal.interviewId === roomId;
  if (!isOwnerKind(principal)) return false;
  const interview = await interviewRepository.findById(roomId);
  return interview?.interviewerId === principal.userId;
};
