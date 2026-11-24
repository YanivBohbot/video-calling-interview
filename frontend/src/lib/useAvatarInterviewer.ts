import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentEventsEnum, LiveAvatarSession, SessionEvent } from '@heygen/liveavatar-web-sdk';
import type { ApiFetch } from './api';
import { AiApiError, createAiInterviewerApi } from './aiInterviewer';
import { AVATAR_OPENING_MESSAGE } from './aiChat';
import { createTurnQueue, speakable } from './avatarTurns';
import type { AskedQuestion } from './questions';

// 'loading': looking for the interview's session. 'none': no session yet (the room may offer
// the avatar). 'text': the interview's session is a text chat (the AI panel's business).
// 'connecting' / 'live' / 'dropped': an avatar session is active, its avatar connecting,
// connected, or gone (Reconnect). 'finished': the avatar session is over.
export type AvatarStatus = 'loading' | 'none' | 'text' | 'connecting' | 'live' | 'dropped' | 'finished';
export type AvatarEndedBy = 'candidate' | 'agent' | 'interviewer';

const POLL_MS = 3000;
const UNAVAILABLE = 'The AI interviewer is unavailable right now.';
const AVATAR_FAILED = 'The avatar could not connect. Check that your microphone is allowed, then reconnect.';
// The agent ended the interview: the avatar says goodbye, then stops. If the end of its
// speech never comes, stop anyway after this long.
const GOODBYE_MAX_MS = 60_000;

const messageOf = (err: unknown) => (err instanceof AiApiError ? err.message : UNAVAILABLE);

// The candidate's interview with the LiveAvatar avatar. The avatar is only ears, mouth and
// face: what it hears (`user.transcription`) goes to the AI interviewer's usual turn endpoint,
// and the agent's full reply is spoken with `repeat`. Lines heard while the agent thinks or the
// avatar speaks are held and sent together afterwards (avatarTurns). The session is polled, so
// an End clicked by the interviewer stops the avatar.
export function useAvatarInterviewer({
  apiFetch,
  interviewId,
  enabled,
  getCode,
  onQuestion,
  onAvatarStart,
}: {
  apiFetch: ApiFetch;
  interviewId: string;
  // The room is loaded (the invite was accepted).
  enabled: boolean;
  // The shared editor's latest content, sent with every turn.
  getCode: () => { code: string; language: string };
  // The avatar moved to a question: the room shows it and opens the tab it needs.
  onQuestion: (question: AskedQuestion) => void;
  // The avatar is about to connect: the room leaves its video call (no echo, no mic conflict).
  onAvatarStart: () => void;
}) {
  const api = useMemo(() => createAiInterviewerApi(apiFetch, interviewId), [apiFetch, interviewId]);
  const [status, setStatusState] = useState<AvatarStatus>('loading');
  const [endedBy, setEndedBy] = useState<AvatarEndedBy | null>(null);
  const [avatarLine, setAvatarLine] = useState('');
  const [heardLine, setHeardLine] = useState('');
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The interview's language (en / he), from the avatar token: captions read right-to-left in Hebrew.
  const [captionLanguage, setCaptionLanguage] = useState('en');

  const statusRef = useRef<AvatarStatus>('loading');
  const setStatus = useCallback((next: AvatarStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const avatarRef = useRef<LiveAvatarSession | null>(null);
  const queueRef = useRef(createTurnQueue());
  const turnRef = useRef<AbortController | null>(null);
  // The opening turn went out (a reloaded room must not greet again).
  const openedRef = useRef(false);
  // A reply was handed to the avatar, whose end of speech releases the queue.
  const speakingRef = useRef(false);
  // The agent ended the interview: stop once its goodbye is said.
  const endingRef = useRef(false);
  const finishedRef = useRef(false);

  const getCodeRef = useRef(getCode);
  getCodeRef.current = getCode;
  const onQuestionRef = useRef(onQuestion);
  onQuestionRef.current = onQuestion;
  const onAvatarStartRef = useRef(onAvatarStart);
  onAvatarStartRef.current = onAvatarStart;

  // Stops the avatar (and its billing). Its own `session.disconnected` is then ignored.
  const stopAvatar = useCallback(() => {
    const avatar = avatarRef.current;
    avatarRef.current = null;
    speakingRef.current = false;
    avatar?.stop().catch(() => {});
  }, []);

  const close = useCallback(
    (by: AvatarEndedBy) => {
      finishedRef.current = true;
      turnRef.current?.abort();
      stopAvatar();
      setBusy(false);
      setThinking(false);
      setEndedBy(by);
      setStatus('finished');
    },
    [stopAvatar, setStatus],
  );

  // Turn → reply → speech → next turn. Mutually recursive, hence the refs.
  const runTurnRef = useRef<(text: string) => Promise<void>>(async () => {});
  const afterReplyRef = useRef<() => void>(() => {});

  afterReplyRef.current = () => {
    if (endingRef.current) return close('agent');
    setBusy(false);
    const held = queueRef.current.replyEnded();
    if (held) void runTurnRef.current(held);
  };

  runTurnRef.current = async (text: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || finishedRef.current) return;
    // Synchronously, before any await: what is heard from now on is held.
    queueRef.current.replyStarted();
    setBusy(true);
    setThinking(true);
    setError(null);
    if (text !== AVATAR_OPENING_MESSAGE) setHeardLine(text);
    const { code, language } = getCodeRef.current();
    const turn = new AbortController();
    turnRef.current = turn;
    let reply = '';
    let ended = false;
    try {
      await api.send(
        sessionId,
        { text, code, language },
        (event) => {
          if (event.type === 'token') reply += event.text;
          else if (event.type === 'question') onQuestionRef.current(event.question);
          else if (event.type === 'done') ended = event.ended;
          else if (event.type === 'error') setError(event.message);
        },
        turn.signal,
      );
    } catch (err) {
      if (turn.signal.aborted) return;
      setError(messageOf(err));
    } finally {
      if (turnRef.current === turn) turnRef.current = null;
      setThinking(false);
    }
    if (finishedRef.current) return;
    if (ended) {
      endingRef.current = true;
      setTimeout(() => {
        if (!finishedRef.current) close('agent');
      }, GOODBYE_MAX_MS);
    }
    const spoken = speakable(reply);
    if (spoken) setAvatarLine(spoken);
    const avatar = avatarRef.current;
    if (spoken && avatar) {
      try {
        avatar.repeat(spoken);
        speakingRef.current = true;
        return; // released by avatar.speak_ended
      } catch {
        setError('The avatar could not speak. The reply is shown below.');
      }
    }
    afterReplyRef.current();
  };

  const heard = useCallback((text: string) => {
    if (finishedRef.current) return;
    const line = text.trim();
    if (line) setHeardLine(line);
    const message = queueRef.current.heard(text);
    if (message) void runTurnRef.current(message);
  }, []);

  // Connects a new avatar to the active session (a first start or a reconnect).
  const connect = useCallback(
    async (sessionId: string) => {
      setStatus('connecting');
      setError(null);
      let avatar: LiveAvatarSession | null = null;
      try {
        const { sessionToken, language } = await api.avatarToken(sessionId);
        if (finishedRef.current) return false;
        setCaptionLanguage(language);
        const session = new LiveAvatarSession(sessionToken, { voiceChat: {} });
        avatar = session;
        avatarRef.current = session;
        session.on(SessionEvent.SESSION_STREAM_READY, () => {
          if (videoRef.current) session.attach(videoRef.current);
        });
        session.on(SessionEvent.SESSION_DISCONNECTED, () => {
          if (avatarRef.current !== session) return; // stopped by us
          avatarRef.current = null;
          if (finishedRef.current) return;
          setStatus('dropped');
          if (speakingRef.current) {
            speakingRef.current = false;
            afterReplyRef.current();
          }
        });
        session.on(AgentEventsEnum.USER_TRANSCRIPTION, (event) => heard(event.text));
        session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => queueRef.current.replyStarted());
        session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
          if (avatarRef.current !== session || !speakingRef.current) return;
          speakingRef.current = false;
          afterReplyRef.current();
        });
        await session.start();
        if (avatarRef.current !== session) {
          // Ended (or the room closed) while connecting.
          session.stop().catch(() => {});
          return false;
        }
        setStatus('live');
        return true;
      } catch (err) {
        if (avatar && avatarRef.current === avatar) {
          avatarRef.current = null;
          avatar.stop().catch(() => {});
        }
        if (finishedRef.current) return false;
        setStatus('dropped');
        setError(err instanceof AiApiError ? err.message : AVATAR_FAILED);
        return false;
      }
    },
    [api, heard, setStatus],
  );

  const greetOnce = useCallback(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    void runTurnRef.current(AVATAR_OPENING_MESSAGE);
  }, []);

  // The candidate starts the interview with the avatar.
  const start = useCallback(async () => {
    if (statusRef.current !== 'none') return;
    setStatus('connecting');
    setError(null);
    setEndedBy(null);
    let sessionId: string;
    try {
      sessionId = await api.start(getCodeRef.current().language, 'avatar');
    } catch (err) {
      setStatus('none');
      setError(messageOf(err));
      return;
    }
    sessionIdRef.current = sessionId;
    finishedRef.current = false;
    endingRef.current = false;
    openedRef.current = false;
    onAvatarStartRef.current();
    if (await connect(sessionId)) greetOnce();
  }, [api, connect, greetOnce, setStatus]);

  // A new avatar for the same session (the previous one dropped, or the room was reloaded).
  const reconnect = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (statusRef.current !== 'dropped' || !sessionId) return;
    onAvatarStartRef.current();
    if (await connect(sessionId)) greetOnce();
  }, [connect, greetOnce]);

  // The candidate's End: the avatar stops at once, the report is written in the background.
  const end = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || finishedRef.current) return;
    close('candidate');
    try {
      await api.finish(sessionId);
    } catch (err) {
      setError(messageOf(err));
    }
  }, [api, close]);

  // "Type instead": a typed message goes the same way as a spoken one.
  const sendTyped = useCallback((text: string) => heard(text), [heard]);

  // The interview's session, once the room is loaded: a reloaded room finds its avatar session
  // (Reconnect: the microphone needs a click) and the question on screen.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const id = await api.current();
      if (cancelled) return;
      if (!id) return setStatus('none');
      const session = await api.get(id);
      if (cancelled) return;
      if (session.mode !== 'avatar') return setStatus('text');
      sessionIdRef.current = id;
      openedRef.current = session.messages.length > 0;
      if (session.presentedQuestion) onQuestionRef.current(session.presentedQuestion);
      if (session.status === 'active') {
        setStatus('dropped');
      } else {
        finishedRef.current = true;
        setStatus('finished');
      }
    })().catch(() => {
      // Unknown: the room offers what it would without a session; a start would be refused.
      if (!cancelled) setStatus('none');
    });
    return () => {
      cancelled = true;
    };
  }, [api, enabled, setStatus]);

  // An active avatar session is polled (not during a turn): the interviewer may end it.
  const active = status === 'connecting' || status === 'live' || status === 'dropped';
  useEffect(() => {
    if (!active || thinking) return;
    const timer = setInterval(() => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || finishedRef.current || turnRef.current) return;
      api
        .get(sessionId)
        .then((session) => {
          if (session.status === 'finished' && !finishedRef.current && !endingRef.current) close('interviewer');
        })
        .catch(() => {}); // the next poll tries again
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, thinking, api, close]);

  // Leaving the page or the room stops the avatar (its minutes are billed).
  useEffect(() => {
    const onUnload = () => avatarRef.current?.stop().catch(() => {});
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      turnRef.current?.abort();
      stopAvatar();
    };
  }, [stopAvatar]);

  return {
    status,
    endedBy,
    avatarLine,
    heardLine,
    thinking,
    busy,
    error,
    captionLanguage,
    videoRef,
    start,
    reconnect,
    end,
    sendTyped,
    stop: stopAvatar,
  };
}

export type AvatarInterviewer = ReturnType<typeof useAvatarInterviewer>;
