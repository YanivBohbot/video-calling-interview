import type { AiMessage, TurnEvent } from './aiInterviewer';

// The chat as the candidate sees it while the answer streams in. `open`: the last
// interviewer message is still being written, so the next token continues it. A tool call
// closes it (the model's next words are a new message, as in the saved history).
export type ChatState = { messages: AiMessage[]; open: boolean };

// Sent for the candidate when they start a session, so the agent opens the conversation.
export const OPENING_MESSAGE = "Hi, I'm ready to start.";

// The chat as shown: without that automatic first message, which nobody typed.
export const withoutOpening = (messages: AiMessage[]) =>
  messages[0]?.role === 'candidate' && messages[0].text === OPENING_MESSAGE ? messages.slice(1) : messages;

// Same history? A poll that brings nothing new must not re-render (or re-scroll) the chat.
export const sameMessages = (a: AiMessage[], b: AiMessage[]) =>
  a.length === b.length && a.every((m, i) => m.role === b[i].role && m.text === b[i].text);

export const addCandidateMessage = (state: ChatState, text: string): ChatState => ({
  messages: [...state.messages, { role: 'candidate', text }],
  open: false,
});

export const applyTurnEvent = (state: ChatState, event: TurnEvent): ChatState => {
  if (event.type !== 'token') return { ...state, open: false };
  const last = state.messages.at(-1);
  if (state.open && last?.role === 'interviewer') {
    return { messages: [...state.messages.slice(0, -1), { ...last, text: last.text + event.text }], open: true };
  }
  return { messages: [...state.messages, { role: 'interviewer', text: event.text }], open: true };
};
