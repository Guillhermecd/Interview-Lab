export interface ReceivedEvent {
  event: string;
  data: unknown;
}

// Parses the body of a text/event-stream response into its events.
export function parseSseBody(body: string): ReceivedEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length);
      const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length);
      if (event === undefined || data === undefined) {
        throw new Error(`Malformed SSE block: ${block}`);
      }
      return { event, data: JSON.parse(data) as unknown };
    });
}
