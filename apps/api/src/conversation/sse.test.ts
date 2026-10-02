import { describe, expect, it } from 'vitest';
import { formatSseEvent } from './sse.js';

describe('formatSseEvent', () => {
  it('writes the event name and the JSON payload, ended by a blank line', () => {
    expect(formatSseEvent({ event: 'token', data: { text: 'Olá' } })).toBe(
      'event: token\ndata: {"text":"Olá"}\n\n',
    );
  });

  it('keeps line breaks of the payload inside the single data line', () => {
    const formatted = formatSseEvent({
      event: 'sql',
      data: { sql: 'SELECT 1\nFROM regions\n\nevent: done', attempt: 1 },
    });

    expect(formatted.split('\n')).toHaveLength(4);
    expect(formatted).toBe(
      'event: sql\ndata: {"sql":"SELECT 1\\nFROM regions\\n\\nevent: done","attempt":1}\n\n',
    );
  });
});
