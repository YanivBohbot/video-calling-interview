// The avatar's turn-taking, without React or the SDK. What the candidate says while the agent
// is thinking or the avatar is speaking is held, then sent as one message once the avatar is
// done: never two replies at once (the backend refuses a second turn with 409 anyway).
export const createTurnQueue = () => {
  let busy = false;
  let pending: string[] = [];
  return {
    // A transcription: the message to send now, or null (blank, or held until the reply ends).
    heard(text: string): string | null {
      const line = text.trim();
      if (!line) return null;
      if (!busy) return line;
      pending.push(line);
      return null;
    },
    // A turn was sent, or the avatar started speaking.
    replyStarted() {
      busy = true;
    },
    // The avatar is done (or the turn failed): what was held meanwhile, as one message.
    replyEnded(): string | null {
      busy = false;
      const held = pending.join(' ');
      pending = [];
      return held || null;
    },
  };
};

export type TurnQueue = ReturnType<typeof createTurnQueue>;

// The agent's reply as the avatar says it: replies are meant to be spoken, but a stray
// markdown character would be read out loud.
export const speakable = (text: string) => text.replace(/[*#`]/g, '').replace(/\s+/g, ' ').trim();

// 'loading': looking for the interview's session. 'none': no session yet (the room may offer
// the avatar). 'text': the interview's session is a text chat (the AI panel's business).
// 'connecting' / 'live' / 'dropped': an avatar session is active, its avatar connecting,
// connected, or gone (Reconnect). 'finished': the avatar session is over.
export type AvatarStatus = 'loading' | 'none' | 'text' | 'connecting' | 'live' | 'dropped' | 'finished';

// The interview's one AI session, as the avatar sees it. An active avatar session found again
// (reloaded room, refused start) is 'dropped': the candidate reconnects with a click.
export const statusForSession = (session: { mode?: string; status: string } | null): AvatarStatus => {
  if (!session) return 'none';
  if (session.mode !== 'avatar') return 'text';
  return session.status === 'active' ? 'dropped' : 'finished';
};

// "Type instead" works with the avatar or without it (dropped, past the reconnect limit: the
// reply is then only shown), never while a reply is on its way.
export const canTypeToAvatar = (status: AvatarStatus, busy: boolean) => (status === 'live' || status === 'dropped') && !busy;
