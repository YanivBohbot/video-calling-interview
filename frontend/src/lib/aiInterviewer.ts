import type { ApiFetch } from './api';
import { createSseParser } from './sse';
import type { AskedQuestion } from './questions';

// The AI interviewer of an interview room: /api/interviews/:id/ai on the backend.
// No React here — the room's hook (useAiInterviewer) holds the state.

export type AiMessage = { role: 'candidate' | 'interviewer'; text: string };

// Mirror of the backend's PracticeReportSchema (backend/src/ai/agents/coach/report.js).
export type AiReport = {
  summary: string;
  strengths: string[];
  improvements: string[];
  testsRun: { runId: string; input: string; expected: string; actual: string; passed: boolean }[];
  complexity: { time: string; space: string; comment: string };
  nextSteps: string[];
};

export type ReportStatus = 'none' | 'pending' | 'ready' | 'failed';

// 'avatar': the candidate runs the whole interview with the LiveAvatar avatar voicing the agent.
export type AiMode = 'text' | 'avatar';

export type AiSession = {
  id: string;
  mode: AiMode;
  status: 'active' | 'finished';
  language: string;
  code: string | null;
  startedAt: string;
  finishedAt: string | null;
  messages: AiMessage[];
  reportStatus: ReportStatus;
  report: AiReport | null;
  // Avatar mode: the question the avatar is asking (null before the first one).
  presentedQuestion?: AskedQuestion | null;
};

export type TurnEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string }
  // Avatar mode: the agent moved to this question of the interview.
  | { type: 'question'; question: AskedQuestion }
  | { type: 'done'; ended: boolean; limited: boolean }
  | { type: 'error'; message: string };

// A refusal from the backend; `message` is the backend's own (safe to show).
export class AiApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const refusal = async (res: Response) => {
  const body = await res.json().catch(() => ({}));
  return new AiApiError(res.status, body?.message || 'The AI interviewer is unavailable right now.', body?.retryAfter);
};

const toTurnEvent = (event: string, data: unknown): TurnEvent | null => {
  const d = (data ?? {}) as Record<string, unknown>;
  if (event === 'token') return { type: 'token', text: String(d.text ?? '') };
  if (event === 'tool') return { type: 'tool', name: String(d.name ?? '') };
  if (event === 'question') {
    return {
      type: 'question',
      question: {
        index: Number(d.index),
        text: String(d.text ?? ''),
        category: d.category as AskedQuestion['category'],
        difficulty: d.difficulty as AskedQuestion['difficulty'],
      },
    };
  }
  if (event === 'done') return { type: 'done', ended: d.ended === true, limited: d.limited === true };
  if (event === 'error') return { type: 'error', message: String(d.message ?? 'The interviewer is unavailable right now.') };
  return null;
};

export const createAiInterviewerApi = (apiFetch: ApiFetch, interviewId: string) => {
  const base = `/api/interviews/${encodeURIComponent(interviewId)}/ai/sessions`;

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await apiFetch(path, init);
    if (!res.ok) throw await refusal(res);
    return res.json() as Promise<T>;
  };
  const post = (body?: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    // The interview's session (null before it starts): one per interview.
    current: async () => (await request<{ sessionId: string | null }>(`${base}/current`, undefined)).sessionId,

    // `language`: the editor's language (javascript, python…), not the interview's.
    start: async (language: string, mode: AiMode = 'text') => (await request<{ id: string }>(base, post({ language, mode }))).id,

    // A short-lived LiveAvatar token for an active avatar session (also to reconnect a dropped
    // avatar). `language`: the interview's (en / he).
    avatarToken: (sessionId: string) =>
      request<{ sessionToken: string; language: string }>(`${base}/${encodeURIComponent(sessionId)}/avatar-token`, post()),

    get: (sessionId: string) => request<AiSession>(`${base}/${encodeURIComponent(sessionId)}`, undefined),

    finish: async (sessionId: string) => {
      await request(`${base}/${encodeURIComponent(sessionId)}/finish`, post());
    },

    // Writes a failed report again (the interviewer only).
    retryReport: async (sessionId: string) => {
      await request(`${base}/${encodeURIComponent(sessionId)}/report`, post());
    },

    // One candidate message; the answer arrives as events. Refusals throw before any event.
    send: async (
      sessionId: string,
      body: { text: string; code: string; language: string },
      onEvent: (event: TurnEvent) => void,
      signal?: AbortSignal,
    ) => {
      const res = await apiFetch(`${base}/${encodeURIComponent(sessionId)}/messages`, { ...post(body), signal });
      if (!res.ok) throw await refusal(res);
      if (!res.body) return;
      const feed = createSseParser(({ event, data }) => {
        const turnEvent = toTurnEvent(event, data);
        if (turnEvent) onEvent(turnEvent);
      });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        feed(value);
      }
    },
  };
};

export type AiInterviewerApi = ReturnType<typeof createAiInterviewerApi>;
