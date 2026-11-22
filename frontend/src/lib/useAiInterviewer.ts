import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiFetch } from './api';
import { AiApiError, createAiInterviewerApi, type AiSession } from './aiInterviewer';
import { addCandidateMessage, applyTurnEvent, type ChatState } from './aiChat';

export type AiRole = 'candidate' | 'interviewer';
export type AiPhase = 'loading' | 'idle' | 'active' | 'finished';

const POLL_MS = 3000;
// The report usually takes well under a minute; after this many polls, stop and offer "Check again".
const MAX_REPORT_POLLS = 40;
// The candidate's first message: the backend starts a silent session, the agent opens on it.
const OPENING_MESSAGE = "Hi, I'm ready to start.";
const UNAVAILABLE = 'The AI interviewer is unavailable right now.';

const messageOf = (err: unknown) => (err instanceof AiApiError ? err.message : UNAVAILABLE);

// The state of the room's AI interviewer panel. The candidate starts the session and
// chats (answers stream in); the interviewer only reads, by polling every 3 s.
export function useAiInterviewer({ apiFetch, interviewId, role }: { apiFetch: ApiFetch; interviewId: string; role: AiRole }) {
  const api = useMemo(() => createAiInterviewerApi(apiFetch, interviewId), [apiFetch, interviewId]);
  const [phase, setPhase] = useState<AiPhase>('loading');
  const [session, setSession] = useState<AiSession | null>(null);
  const [chat, setChat] = useState<ChatState>({ messages: [], open: false });
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportWaitOver, setReportWaitOver] = useState(false);

  const sessionRef = useRef<AiSession | null>(null);
  const lastIdRef = useRef<string | null>(null); // kept after the session ends, for its report
  const replyingRef = useRef(false);
  const reportPollsRef = useRef(0);
  const turnRef = useRef<AbortController | null>(null);

  const show = useCallback((next: AiSession | null) => {
    sessionRef.current = next;
    setSession(next);
    if (!next) return setPhase('idle');
    lastIdRef.current = next.id;
    // Mid-reply, the streamed chat is ahead of the saved history: don't overwrite it.
    if (!replyingRef.current) setChat({ messages: next.messages, open: false });
    setPhase(next.status === 'active' ? 'active' : 'finished');
  }, []);

  // Fetches the interview's current session (or the last one, for its report).
  const load = useCallback(async () => {
    const id = (await api.current()) ?? lastIdRef.current;
    if (!id) return show(null);
    const known = sessionRef.current;
    if (known?.id === id && known.status === 'finished') {
      if (known.reportStatus !== 'pending') return; // report settled: nothing will change
      if (++reportPollsRef.current > MAX_REPORT_POLLS) return setReportWaitOver(true);
    }
    show(await api.get(id));
  }, [api, show]);

  const tick = useCallback(() => {
    load().catch((err) => setError(messageOf(err)));
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
        reportPollsRef.current = 0;
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
    reportPollsRef.current = 0;
    setReportWaitOver(false);
    tick();
  }, [tick]);

  return { phase, session, messages: chat.messages, replying, error, reportWaitOver, start, send, finish, checkReport };
}
