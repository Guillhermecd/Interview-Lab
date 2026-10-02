import type { AnswerStreamEventName, AnswerStreamEvents } from '@interview-lab/shared';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Tells reverse proxies (nginx) not to buffer the stream.
  'X-Accel-Buffering': 'no',
} as const;

export type AnswerStreamEvent = {
  [Name in AnswerStreamEventName]: { event: Name; data: AnswerStreamEvents[Name] };
}[AnswerStreamEventName];

// One Server-Sent Event. JSON.stringify never emits a raw line break, so the
// payload always fits the single "data:" line.
export function formatSseEvent(event: AnswerStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
