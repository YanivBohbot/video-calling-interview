// sessionStorage can throw (private windows, blocked storage): treat that as "nothing stored".
export const readStorage = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
export const writeStorage = (key: string, value: string | null) => {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the session just won't survive a refresh */
  }
};

const inviteKey = (interviewId: string) => `talentiq.invite.${interviewId}`;

// Candidate invite secrets, per interview (the URL fragment is removed once read).
export const storeInvite = (interviewId: string, secret: string) => writeStorage(inviteKey(interviewId), secret);
export const readInvite = (interviewId: string) => readStorage(inviteKey(interviewId));
