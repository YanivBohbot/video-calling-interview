import { describe, it, expect } from 'vitest';
import { pollStep, MAX_REPORT_POLLS, type PollState } from './aiPolling';
import type { AiSession } from './aiInterviewer';

const session = (extra: Partial<AiSession> = {}): AiSession => ({
  id: 's1', status: 'active', language: 'python', code: null, startedAt: '', finishedAt: null,
  messages: [], reportStatus: 'none', report: null, ...extra,
});
const fresh: PollState = { sessionId: null, polls: 0, waitOver: false };

describe('report polling', () => {
  it('fetches an active session on every poll', () => {
    expect(pollStep(fresh, 's1', null).fetch).toBe(true);
    expect(pollStep({ sessionId: 's1', polls: 0, waitOver: false }, 's1', session()).fetch).toBe(true);
  });

  it('stops fetching once the report is settled', () => {
    const known = session({ status: 'finished', reportStatus: 'ready' });
    expect(pollStep({ sessionId: 's1', polls: 3, waitOver: false }, 's1', known).fetch).toBe(false);
  });

  it(`gives up after ${MAX_REPORT_POLLS} polls on a pending report`, () => {
    const known = session({ status: 'finished', reportStatus: 'pending' });
    const step = pollStep({ sessionId: 's1', polls: MAX_REPORT_POLLS, waitOver: false }, 's1', known);
    expect(step).toEqual({ fetch: false, poll: { sessionId: 's1', polls: MAX_REPORT_POLLS, waitOver: true } });
  });

  it('a new session starts a fresh wait, even after the last one gave up', () => {
    const known = session({ status: 'finished', reportStatus: 'pending' });
    const step = pollStep({ sessionId: 's1', polls: MAX_REPORT_POLLS, waitOver: true }, 's2', known);
    expect(step).toEqual({ fetch: true, poll: { sessionId: 's2', polls: 0, waitOver: false } });
  });
});
