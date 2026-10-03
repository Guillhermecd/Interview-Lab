export interface ServerSentEvent {
  event: string;
  data: string;
}

// Reads a text/event-stream body and yields each complete event. Handles events
// split across network chunks and several events in one chunk.
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const parsed = parseBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed) {
          yield parsed;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): ServerSentEvent | undefined {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice('data:'.length).trimStart());
    }
  }
  return data.length > 0 ? { event, data: data.join('\n') } : undefined;
}
