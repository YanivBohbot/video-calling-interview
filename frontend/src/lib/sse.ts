// Server-sent events read from a fetch() body (the AI stream is a POST, so EventSource
// can't be used). Feed it the decoded text as it arrives; it calls `onEvent` once per
// complete event ("event: x\ndata: {json}\n\n") and keeps any incomplete tail for later.
export type SseEvent = { event: string; data: unknown };

export const createSseParser = (onEvent: (event: SseEvent) => void) => {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (data.length > 0) onEvent({ event, data: JSON.parse(data.join('\n')) });
      end = buffer.indexOf('\n\n');
    }
  };
};
