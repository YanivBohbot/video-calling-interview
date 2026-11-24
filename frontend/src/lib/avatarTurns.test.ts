import { describe, it, expect } from 'vitest';
import { createTurnQueue, speakable } from './avatarTurns';

describe('avatar turn queue', () => {
  it('sends what is heard while idle', () => {
    const queue = createTurnQueue();
    expect(queue.heard('a')).toBe('a');
  });

  it('holds what is heard while busy and sends it as one message afterwards', () => {
    const queue = createTurnQueue();
    queue.replyStarted();
    expect(queue.heard('a')).toBeNull();
    expect(queue.heard('b')).toBeNull();
    expect(queue.replyEnded()).toBe('a b');
    // Idle again: the next line goes out at once, and nothing is left over.
    expect(queue.heard('c')).toBe('c');
    queue.replyStarted();
    expect(queue.replyEnded()).toBeNull();
  });

  it('ignores blank transcriptions', () => {
    const queue = createTurnQueue();
    expect(queue.heard('   ')).toBeNull();
    queue.replyStarted();
    queue.heard('');
    expect(queue.replyEnded()).toBeNull();
  });

  it('stays busy when the reply starts twice (sent, then spoken)', () => {
    const queue = createTurnQueue();
    queue.replyStarted();
    queue.replyStarted();
    expect(queue.heard('a')).toBeNull();
    expect(queue.replyEnded()).toBe('a');
  });
});

describe('speakable', () => {
  it('drops markdown characters and collapses spaces', () => {
    expect(speakable('## Next **question**: use `map`.\n\n* one')).toBe('Next question: use map. one');
  });

  it('is empty for a reply with no words', () => {
    expect(speakable('  ** ')).toBe('');
  });
});
