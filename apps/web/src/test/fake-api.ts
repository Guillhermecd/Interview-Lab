import type { AnswerStreamEventName, AnswerStreamEvents } from '@interview-lab/shared';

export type StreamEvent = {
  [Name in AnswerStreamEventName]: { event: Name; data: AnswerStreamEvents[Name] };
}[AnswerStreamEventName];

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function sseBody(events: StreamEvent[]): string {
  return events
    .map((item) => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`)
    .join('');
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

// Delivers the events a moment after the request, like a real stream, and
// fails with AbortError if the request is aborted before that — so a test
// notices when the screen cancels an answer it should have kept.
export function sseResponse(events: StreamEvent[], signal?: AbortSignal | null): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false;
      signal?.addEventListener('abort', () => {
        if (!settled) {
          settled = true;
          controller.error(abortError());
        }
      });
      setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        controller.enqueue(encoder.encode(sseBody(events)));
        controller.close();
      }, 20);
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// A stream that sends the given events and then stays open until the request
// is aborted, like a slow answer.
export function openSseResponse(events: StreamEvent[], signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseBody(events)));
      signal.addEventListener('abort', () => {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

type Handler = (init: RequestInit) => Response | Promise<Response>;

// Replaces fetch with handlers keyed by "METHOD /path" and records the calls.
export class FakeApi {
  readonly calls: { key: string; body: unknown }[] = [];
  private readonly handlers = new Map<string, Handler>();

  on(key: string, handler: Handler): this {
    this.handlers.set(key, handler);
    return this;
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init.method ?? 'GET'} ${url}`;
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    this.calls.push({ key, body });

    // A handler registered without a query string answers any query of that path.
    const handler = this.handlers.get(key) ?? this.handlers.get(key.split('?')[0] ?? key);
    if (!handler) {
      return jsonResponse({ code: 'NOT_FOUND', message: 'Recurso não encontrado.' }, 404);
    }
    if (init.signal?.aborted === true) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    return handler(init);
  };
}

export const TEST_USER = {
  id: 'u-1',
  email: 'ana@example.com',
  name: 'Ana',
  canManageCatalog: false,
};
// The same person once promoted with `db:promote-admin`.
export const TEST_ADMIN = { ...TEST_USER, canManageCatalog: true };
