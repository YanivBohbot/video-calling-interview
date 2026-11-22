import { describe, it, expect } from 'vitest';
import { createSseParser, type SseEvent } from './sse';

describe('createSseParser', () => {
  it('delivers an event split across two chunks once, whole', () => {
    const got: SseEvent[] = [];
    const feed = createSseParser((e) => got.push(e));
    feed('event: token\ndata: {"te');
    feed('xt":"Hi"}\n\n');
    expect(got).toEqual([{ event: 'token', data: { text: 'Hi' } }]);
  });

  it('delivers several events from one chunk, in order', () => {
    const got: SseEvent[] = [];
    const feed = createSseParser((e) => got.push(e));
    feed('event: token\ndata: {"text":"a"}\n\nevent: done\ndata: {"ended":false,"limited":false}\n\n');
    expect(got.map((e) => e.event)).toEqual(['token', 'done']);
  });

  it('keeps an incomplete last event until its end arrives', () => {
    const got: SseEvent[] = [];
    const feed = createSseParser((e) => got.push(e));
    feed('event: token\ndata: {"text":"a"}\n\nevent: done\ndata: {"ended":true');
    expect(got).toHaveLength(1);
    feed(',"limited":false}\n\n');
    expect(got[1]).toEqual({ event: 'done', data: { ended: true, limited: false } });
  });
});
