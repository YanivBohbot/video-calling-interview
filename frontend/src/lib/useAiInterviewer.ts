import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiFetch } from './api';
import { AiApiError, createAiInterviewerApi, type AiSession } from './aiInterviewer';
import { addCandidateMessage, applyTurnEvent, sameMessages, type ChatState } from './aiChat';
import { pollStep, type PollState } from './aiPolling';

export type AiRole = 'candidate' | 'interviewer';
export type AiPhase = 'loading' | 'idle' | 'active' | 'finished';

const POLL_MS = 3000;
// The candidate's first message: the backend starts a silent session, the agent opens on it.
const OPENING_MESSAGE = "Hi, I'm ready to start.";
const UNAVAILABLE = 'The AI interviewer is unavailable right now.';

const messageOf = (err: unknown) => (err instanceof AiApiError ? err.message : UNAVAILABLE);

// The state of the room's AI interviewer panel. The candidate starts the session and
// chats (answers stream in); the interviewer only reads, by polling every 3 s. Both see the
// interview's latest session, so a reloaded room shows the conversation and its report.
export function useAiInterviewer({ apiFetch, interviewId, role }: { apiFetch: ApiFetch; interviewId: string; role: AiRole }) {
  const api = useMemo(() => createAiInterviewerApi(apiFetch, interviewId), [apiFetch, interviewId]);
  const [phase, setPhase] = useState<AiPhase>('loading');
  const [session, setSession] = useState<AiSession | null>(null);
  const [chat, setChat] = useState<ChatState>({ messages: [], open: false });
  const [replying, setReplying] = useState(false);
  // `error`: what the candidate's last action got (kept until the next one). `pollError`:
  // the last poll failed (cleared by the next poll that works).
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [reportWaitOver, setReportWaitOver] = useState(false);

  const sessionRef = useRef<AiSession | null>(null);
  const pollRef = useRef<PollState>({ sessionId: null, polls: 0, waitOver: false });
  const replyingRef = useRef(false);
  const turnRef = useRef<AbortController | null>(null);

  const show = useCallback((next: AiSession | null) => {
    sessionRef.current = next;
    setSession(next);
    if (!next) return setPhase('idle');
    // Mid-reply, the streamed chat is ahead of the saved history: don't overwrite it.
    // An unchanged history keeps the same array, so the chat neither re-renders nor scrolls.
    if (!replyingRef.current) {
      setChat((state) => (sameMessages(state.messages, next.messages) ? state : { messages: next.messages, open: false }));
    }
    setPhase(next.status === 'active' ? 'active' : 'finished');
  }, []);

  // Fetches the interview's latest session, unless nothing about it can change any more.
  const load = useCallback(async () => {
    const id = await api.current();
    if (!id) return show(null);
    const step = pollStep(pollRef.current, id, sessionRef.current);
    pollRef.current = step.poll;
    setReportWaitOver(step.poll.waitOver);
    if (step.fetch) show(await api.get(id));
  }, [api, show]);

  const tick = useCallback(() => {
    load().then(
      () => setPollError(null),
      (err) => setPollError(messageOf(err)),
    );
  }, [load]);

  // First load; the interviewer then follows the session live.
  useEffect(() => {
    tick();
    if (role !== 'interviewer') return;
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [tick, role]);

  // The candidate waits for the report (the interviewer's loop already covers it).
  const waitingForReport = role === 'candidate' && phase === 'finished' && session?.reportStatus === 'pending' && !reportWaitOver;
  useEffect(() => {
    if (!waitingForReport) return;
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [waitingForReport, tick]);

  // Leaving the room mid-reply stops the agent (the backend aborts on disconnect).
  useEffect(() => () => turnRef.current?.abort(), []);

  const send = useCallback(
    async (text: string, code: string, language: string) => {
      const current = sessionRef.current;
      if (role !== 'candidate' || !current || current.status !== 'active' || replyingRef.current) return;
      setError(null);
      replyingRef.current = true;
      setReplying(true);
      setChat((state) => addCandidateMessage(state, text));
      const turn = new AbortController();
      turnRef.current = turn;
      let resync = false;
      try {
        await api.send(
          current.id,
          { text, code, language },
          (event) => {
            setChat((state) => applyTurnEvent(state, event));
            if (event.type === 'done' && event.ended) resync = true;
            if (event.type === 'error') setError(event.message);
          },
          turn.signal,
        );
      } catch (err) {
        if (turn.signal.aborted) return;
        setError(messageOf(err));
        resync = true; // refused or failed: the saved history is the truth
      } finally {
        replyingRef.current = false;
        setReplying(false);
        turnRef.current = null;
      }
      if (resync) tick();
    },
    [api, role, tick],
  );

  const start = useCallback(
    async (code: string, language: string) => {
      if (role !== 'candidate') return;
      setError(null);
      try {
        const id = await api.start(language);
        pollRef.current = { sessionId: id, polls: 0, waitOver: false };
        setReportWaitOver(false);
        show(await api.get(id));
      } catch (err) {
        setError(messageOf(err));
        return;
      }
      await send(OPENING_MESSAGE, code, language);
    },
    [api, role, show, send],
  );

  const finish = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    turnRef.current?.abort();
    try {
      await api.finish(current.id);
      await load();
    } catch (err) {
      setError(messageOf(err));
    }
  }, [api, load]);

  const checkReport = useCallback(() => {
    pollRef.current = { ...pollRef.current, polls: 0, waitOver: false };
    setReportWaitOver(false);
    tick();
  }, [tick]);

  return {
    phase,
    session,
    messages: chat.messages,
    replying,
    error: error ?? pollError,
    reportWaitOver,
    start,
    send,
    finish,
    checkReport,
  };
}
