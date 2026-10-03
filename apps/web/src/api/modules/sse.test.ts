import { describe, expect, it } from 'vitest';
import { readServerSentEvents, type ServerSentEvent } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function readAll(chunks: string[]): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  for await (const event of readServerSentEvents(streamOf(chunks))) {
    events.push(event);
  }
  return events;
}

describe('readServerSentEvents', () => {
  it('reads several events from one chunk', async () => {
    await expect(
      readAll(['event: sql\ndata: {"sql":"SELECT 1"}\n\nevent: token\ndata: {"text":"Oi"}\n\n']),
    ).resolves.toEqual([
      { event: 'sql', data: '{"sql":"SELECT 1"}' },
      { event: 'token', data: '{"text":"Oi"}' },
    ]);
  });

  it('joins an event split across chunks, even in the middle of a character', async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"região"}\n\n');
    const middle = 31;
    const decoder = new TextDecoder();
    const chunks = [
      decoder.decode(bytes.slice(0, middle), { stream: true }),
      decoder.decode(bytes.slice(middle)),
    ];

    await expect(readAll(chunks)).resolves.toEqual([{ event: 'token', data: '{"text":"região"}' }]);
  });

  it('accepts CRLF line endings', async () => {
    await expect(readAll(['event: done\r\ndata: {}\r\n\r\n'])).resolves.toEqual([
      { event: 'done', data: '{}' },
    ]);
  });

  it('ignores an incomplete event at the end of the stream', async () => {
    await expect(readAll(['event: done\ndata: {}\n\nevent: token\ndata: {"te'])).resolves.toEqual([
      { event: 'done', data: '{}' },
    ]);
  });

  it('uses "message" when the event has no name and skips blocks without data', async () => {
    await expect(readAll([': comment\n\ndata: x\n\n'])).resolves.toEqual([
      { event: 'message', data: 'x' },
    ]);
  });
});
