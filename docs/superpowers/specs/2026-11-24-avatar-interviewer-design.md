# Avatar interviewer — design

## Intent

Give TalentIQ a face and a voice: when the human interviewer is not in the room, the invited
candidate can run the interview with a talking avatar (LiveAvatar by HeyGen). The avatar greets
the candidate ("Welcome to your interview for the Backend Engineer role at Acme…"), asks the
interview's questions out loud — behavioral questions as a spoken conversation — listens to the
answers through the microphone, follows up, and closes. The human interviewer reads the
transcript and the report afterwards. The same feature is the centrepiece of the demo video that
comes next (separate project: video + README).

Why: make the project more interesting and demonstrable; a real use case (an asynchronous
pre-screen the candidate takes when the interviewer is away).

## Decisions taken with the user

- **Candidate alone with the avatar.** No human interviewer during the avatar part.
- **Only when the interviewer is absent**: the option appears in the candidate room when no owner
  (interviewer/demo principal) is connected to the room.
- **Opt-in per interview**: a checkbox on interview creation (and edit), "The AI interviewer may run
  this interview if I'm not there" — **off by default**.
- **Our agent is the brain, LiveAvatar is only ears, mouth and face** (LiveAvatar FULL mode,
  sandbox-verified on 2026-11-24: with no persona context the avatar never answers by itself;
  `user.transcription` arrives < 1 s after the candidate stops; `repeat(text)` starts speaking
  0.7 s later and says the text verbatim).
- **Avatar**: the sandbox avatar "Wayne" for now (free in sandbox; a paid avatar later is just a
  different id).
- **Language per interview**: English or Hebrew (LiveAvatar `language`: `en` / `he`; our agent
  answers in the same language).
- **Company name**: a new `company` field on the interview, used in the greeting.

## Goals / non-goals / anti-goals

- Goal: a spoken interview with the avatar for every question category; the interviewer gets the
  transcript and a report covering behavioral answers and code.
- Goal: reuse what exists — the AI session (one per interview, caps, history, report), the
  interviewer agent and its tools, the room's editor.
- Non-goal: the avatar inside a live two-person interview (option "A", later maybe).
- Non-goal: video recording of the session; choosing among many avatars; more languages.
- Non-goal: a separate practice page/link.
- Anti-goals: the LiveAvatar API key reaching the browser; the avatar saying anything our agent did
  not write; a candidate starting an avatar session on an interview that did not allow it; credits
  burnt by a session left open.

## Approaches considered

1. **FULL mode, HeyGen's own LLM** with a persona prompt — rejected: a second brain that knows
   neither the live interview nor the code, and that we control badly.
2. **FULL mode, our agent as the brain** (HeyGen = STT + TTS + face; transcript → our backend →
   reply → `repeat`) — **chosen**, validated by the sandbox spike.
3. **LITE mode** (our own STT + TTS, audio pushed to HeyGen) — kept as the fallback if (2) breaks:
   most control and fewer HeyGen credits, but STT, voice-activity and TTS become our code.
4. FULL mode with a "custom LLM" pointing at our backend — rejected: HeyGen must reach our server
   from the Internet (a tunnel in dev) and it never sees the candidate's code.

## How it works

```
Candidate (mic) ─► LiveAvatar (STT) ─► user.transcription ─► frontend
frontend ─► POST /api/interviews/:id/ai/sessions/:sid/messages   (same endpoint as the text chat)
backend: interviewer agent (questions from Interview.questions, company, role, language, code tools)
frontend ◄─ reply text (SSE, as today) ─► avatar.repeat(reply) ─► LiveAvatar (TTS + face) ─► candidate
```

### Backend

- **Interview**: new fields `company String @default("")`, `aiInterviewerEnabled Boolean
  @default(false)`, `language String @default("en")` (`en` | `he`). Create/update schemas, Mongo
  shaping (`toInterviewDoc`) and the candidate room view (`company`, `language`,
  `aiInterviewerEnabled`, never the questions) follow.
- **Interviewer presence**: the realtime channel answers "is an owner in room X?" (`io.in(roomId)`
  sockets whose principal is an owner kind). Exposed to the candidate through the room: an event
  `interviewer-presence { present }` on join and whenever an owner joins/leaves.
- **Avatar token**: `POST /api/interviews/:id/ai/avatar-token` (candidate only; interview must have
  `aiInterviewerEnabled`, no owner present, and an active avatar-mode session of this candidate).
  The backend calls `POST https://api.liveavatar.com/v1/sessions/token` with `X-API-KEY`
  (`LIVEAVATAR_API_KEY`, optional in `config/env.js`; absent ⇒ avatar mode unavailable, text mode
  unchanged) and body `{ mode: "FULL", avatar_id, is_sandbox, max_session_duration, avatar_persona:
  { language } }` — **no persona context**, so HeyGen never answers by itself. Returns only the
  session token. Client in `integrations/liveavatar/client.js`, injected by `container.js`.
  `LIVEAVATAR_AVATAR_ID` (default Wayne) and `LIVEAVATAR_SANDBOX` (default true in dev) are config.
- **Session mode**: an AI session gets `mode: "text" | "avatar"` (column on `ai_practice_sessions`),
  set at start. Avatar mode is the full interview run by the agent; text mode stays the current
  coding helper.
- **Interviewer agent, avatar mode** (same agent, same tools; `ai/prompts/interviewer.js` gains an
  avatar variant): greets with company, role and the number of questions; walks through
  `Interview.questions` **in the interviewer's order**; behavioral / system-design: asks, listens,
  at most 2 follow-ups, then moves on; technical: reads the statement, tells the candidate to use
  the editor, reads and runs code as today. Replies are **spoken**: short, no markdown, no code
  blocks. Answers in the interview's language. Calls `end_session` after the last question. The
  current question index lives in the agent's conversation (no new state); the runtime context
  gains `company`, `language`, `mode`, `questions` (all, text/category/difficulty only — never
  sources).
- **Coach**: the report also covers behavioral answers (structure of the answer, concrete examples,
  what was missing). `requireToolBeforeResponse(run_code)` applies only when the candidate wrote
  code; a behavioral-only session must still get a report.
- **Caps** unchanged (1 session per interview, 60 min, 60 messages, 10 messages/min); the avatar
  session's `max_session_duration` = the remaining time of the AI session.

### Frontend

- **NewInterview / edit**: `company` input, `language` select (English / עברית), the opt-in
  checkbox.
- **CandidateRoom**: when `aiInterviewerEnabled` and the interviewer is absent and no session
  exists yet: a card "Your interviewer isn't here. [Start the interview with the AI interviewer]".
  Starting creates the session in avatar mode, fetches the avatar token, starts
  `@heygen/liveavatar-web-sdk` (`LiveAvatarSession(token, { voiceChat: {} })`, `attach(<video>)`
  on `session.stream_ready`), then sends the opening turn.
- **Turn loop** (`lib/useAvatarInterviewer.ts`): `user.transcription` → `sendMessage(text)` (the
  existing SSE call) → on `done`, `session.repeat(fullReply)`. While the agent is thinking or the
  avatar speaking, new transcriptions are queued and sent as one message afterwards (never two
  replies at once — the backend already refuses concurrent turns with 409).
- **Layout**: the avatar video takes the video area of the candidate room; captions under it
  (what the avatar said, what was understood); the editor tab opens when the current question is
  technical; a "Type instead" fallback input; End button.
- **Ending**: `end_session` (agent) or the candidate's End → `session.stop()` on the avatar, the AI
  session finishes, report written in the background. The interviewer joining mid-session sees the
  conversation and may End it (the avatar says goodbye first).
- **Interviewer room**: shows the transcript as today (avatar turns labelled), the report, and the
  interview's mode/language.

## Constraints

- Keep it simple (user priority): no new agent, no new transport; the avatar is an output/input
  device of the existing agent.
- The API key stays server-side; only short-lived session tokens reach the browser.
- Credits: sandbox in development (≈1 min sessions, free); `max_session_duration` always set;
  `session.stop()` on End, on unload, and when the AI session finishes.
- Architecture rules of `src/ai/` hold: the agent never calls LiveAvatar (it's a frontend device);
  the token client lives in `integrations/`.

## Builder calls (settled after review — marked as Claude's calls, user to check)

1. **One session per interview, mode chosen at start.** `aiInterviewerEnabled` does not gate the
   existing text panel (shipped behaviour unchanged). When the interview allows it and the
   interviewer is absent, the candidate's "AI interviewer" entry point starts an **avatar**
   session; otherwise it starts a text session as today. Either way the interview's one session is
   used.
2. **Current question signal: a new tool `present_question({ index })`** on the interviewer agent
   (avatar mode only). `events.js` turns it into a `question` SSE event; the frontend shows the
   statement in `QuestionBanner` (the candidate does see the text of the question being asked —
   never the others, never sources) and switches tab (`lib/roomQuestions.ts`). This replaces "no
   new state": the index is the last presented question, kept with the session.
3. **Avatar dropped, AI session alive → resume.** The candidate may request a new avatar token for
   the same active avatar-mode session (≤ 10 tokens per session); the "no owner present" check
   applies only at session start. Dev: sandbox (≈1 min) for short checks; one full run on the
   free monthly credits.
4. **No Stream call in avatar mode.** The candidate does not join the Stream video call during an
   avatar session (no echo, no mic conflict). An interviewer who joins mid-session sees the
   transcript (polling, as today) and may End it.
5. **No questions ⇒ no avatar.** The start card is shown only when the interview has at least one
   question; the backend refuses an avatar start otherwise (`409 "This interview has no questions yet"`).
6. **Interviewer's End stops the avatar at once** (no spoken goodbye — no fixed string in its
   mouth); the candidate sees "The interviewer ended the session". The agent's own `end_session`
   still says goodbye.

## Open / left to the builder

- Hebrew voice quality of the sandbox avatar: test first (`language: "he"`, sandbox, free); if it
  is poor, ship English-only and keep the field.
- Exact visuals of the avatar card and captions (follow the room's current style).
- Whether `interviewer-presence` rides on the existing socket or is polled from the room endpoint —
  socket preferred.
