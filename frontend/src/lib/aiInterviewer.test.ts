import { describe, it, expect, vi } from 'vitest';
import { createAiInterviewerApi, type TurnEvent } from './aiInterviewer';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A streamed SSE body arriving in the given chunks.
const sse = (...chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );

const BODY = { text: 'hi', code: 'x', language: 'python' };

describe('AI interviewer API', () => {
  it('send posts to the interview and turns the SSE body into TurnEvents', async () => {
    const apiFetch = vi.fn(async () =>
      sse('event: token\ndata: {"text":"Hel"}\n\nevent: tok', 'en\ndata: {"text":"lo"}\n\nevent: done\ndata: {"ended":false,"limited":false}\n\n'),
    );
    const events: TurnEvent[] = [];
    await createAiInterviewerApi(apiFetch, 'iv-1').send('s1', BODY, (e) => events.push(e));
    expect(events).toEqual([
      { type: 'token', text: 'Hel' },
      { type: 'token', text: 'lo' },
      { type: 'done', ended: false, limited: false },
    ]);
    const [path, init] = apiFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/interviews/iv-1/ai/sessions/s1/messages');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(BODY));
  });

  it('send throws the refusal before any event', async () => {
    const apiFetch = vi.fn(async () => json(409, { message: 'A reply is still being written' }));
    const onEvent = vi.fn();
    await expect(createAiInterviewerApi(apiFetch, 'iv-1').send('s1', BODY, onEvent)).rejects.toMatchObject({
      status: 409,
      message: 'A reply is still being written',
    });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('current returns the active session id or null', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(json(200, { sessionId: 's1' })).mockResolvedValueOnce(json(200, { sessionId: null }));
    const api = createAiInterviewerApi(apiFetch, 'iv-1');
    expect(await api.current()).toBe('s1');
    expect(await api.current()).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith('/api/interviews/iv-1/ai/sessions/current', undefined);
  });

  it('a 429 carries retryAfter', async () => {
    const apiFetch = vi.fn(async () => json(429, { message: 'Too many messages, slow down', retryAfter: 12 }));
    await expect(createAiInterviewerApi(apiFetch, 'iv-1').start('python')).rejects.toMatchObject({ status: 429, retryAfter: 12 });
  });

  it('start returns the new session id', async () => {
    const apiFetch = vi.fn(async () => json(201, { id: 's9', status: 'active', language: 'python' }));
    expect(await createAiInterviewerApi(apiFetch, 'iv-1').start('python')).toBe('s9');
  });
});
