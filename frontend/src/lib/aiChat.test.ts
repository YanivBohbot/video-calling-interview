import { describe, it, expect } from 'vitest';
import { addCandidateMessage, applyTurnEvent, type ChatState } from './aiChat';

const empty: ChatState = { messages: [], open: false };

describe('chat reducer', () => {
  it('appends tokens to the open interviewer message', () => {
    let s = addCandidateMessage(empty, 'hi');
    s = applyTurnEvent(s, { type: 'token', text: 'Hel' });
    s = applyTurnEvent(s, { type: 'token', text: 'lo' });
    expect(s.messages).toEqual([
      { role: 'candidate', text: 'hi' },
      { role: 'interviewer', text: 'Hello' },
    ]);
  });

  it('starts a new interviewer message after a tool call', () => {
    let s = addCandidateMessage(empty, 'is it right?');
    s = applyTurnEvent(s, { type: 'token', text: 'Let me run it.' });
    s = applyTurnEvent(s, { type: 'tool', name: 'run_code' });
    s = applyTurnEvent(s, { type: 'token', text: 'It works.' });
    expect(s.messages.map((m) => m.text)).toEqual(['is it right?', 'Let me run it.', 'It works.']);
  });

  it('a new candidate message never continues the previous answer', () => {
    let s = applyTurnEvent(empty, { type: 'token', text: 'Hi' });
    s = applyTurnEvent(s, { type: 'done', ended: false, limited: false });
    s = addCandidateMessage(s, 'ok');
    s = applyTurnEvent(s, { type: 'token', text: 'Next' });
    expect(s.messages.map((m) => m.text)).toEqual(['Hi', 'ok', 'Next']);
  });
});
