import type { AiSession } from './aiInterviewer';

// The report usually takes well under a minute; after this many polls, stop and offer "Check again".
export const MAX_REPORT_POLLS = 40;

// What the polling knows: which session it follows and how long it has waited for its report.
export type PollState = { sessionId: string | null; polls: number; waitOver: boolean };

// One poll of session `id` (the interview's latest), given the last fetched `known` session:
// fetch it again or not. A new session starts a fresh wait.
export const pollStep = (poll: PollState, id: string, known: AiSession | null): { poll: PollState; fetch: boolean } => {
  if (poll.sessionId !== id) return { fetch: true, poll: { sessionId: id, polls: 0, waitOver: false } };
  if (known?.id !== id || known.status !== 'finished') return { fetch: true, poll };
  if (known.reportStatus !== 'pending' || poll.waitOver) return { fetch: false, poll };
  if (poll.polls >= MAX_REPORT_POLLS) return { fetch: false, poll: { ...poll, waitOver: true } };
  return { fetch: true, poll: { ...poll, polls: poll.polls + 1 } };
};
