import { describe, expect, it } from 'vitest';
import {
  RECENT_MESSAGES_KEPT,
  selectMessagesToSummarize,
  SUMMARIZE_THRESHOLD,
  toConversationContext,
  type StoredMessage,
} from './conversation-memory.js';

function messages(count: number): StoredMessage[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: String(index + 1),
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${String(index + 1)}`,
  }));
}

function ids(selected: StoredMessage[]): string[] {
  return selected.map((message) => message.id);
}

describe('memory rule (D-27)', () => {
  it('keeps the 6 most recent messages and summarizes after 6 more', () => {
    expect(RECENT_MESSAGES_KEPT).toBe(6);
    expect(SUMMARIZE_THRESHOLD).toBe(6);
  });

  it.each([0, 1, 6, 11])('does not summarize a conversation with %i messages', (count) => {
    expect(selectMessagesToSummarize(messages(count))).toEqual([]);
  });

  it('summarizes the 6 oldest messages once there are 12', () => {
    expect(ids(selectMessagesToSummarize(messages(12)))).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('summarizes everything outside the recent window, in order', () => {
    expect(ids(selectMessagesToSummarize(messages(15)))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
  });

  it('never summarizes the 6 most recent messages', () => {
    const selected = ids(selectMessagesToSummarize(messages(20)));

    expect(selected).toHaveLength(14);
    expect(selected).not.toContain('15');
    expect(selected).not.toContain('20');
  });

  it('counts only the messages that are not in the summary yet', () => {
    // After a summary, the caller passes only what came after it.
    const afterSummary = messages(18).slice(6);

    expect(ids(selectMessagesToSummarize(afterSummary))).toEqual(['7', '8', '9', '10', '11', '12']);
  });
});

describe('toConversationContext', () => {
  it('gives the LLM the summary and every message not covered by it', () => {
    const context = toConversationContext({
      summary: 'O usuário analisa vendas.',
      unsummarized: [
        { id: '7', role: 'user', content: 'E por produto?' },
        { id: '8', role: 'assistant', content: 'Segue.', sql: 'SELECT 1' },
      ],
    });

    expect(context).toEqual({
      summary: 'O usuário analisa vendas.',
      recent: [
        { role: 'user', content: 'E por produto?' },
        { role: 'assistant', content: 'Segue.', sql: 'SELECT 1' },
      ],
    });
  });

  it('has no summary for a short conversation', () => {
    expect(toConversationContext({ summary: undefined, unsummarized: [] })).toEqual({
      recent: [],
    });
  });
});
