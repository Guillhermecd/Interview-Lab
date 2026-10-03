import type { QueryResult } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import { applyAnswerEvent, itemsFromMessages, newAnswer } from './chat-state';

const RESULT: QueryResult = {
  columns: [{ name: 'regiao', type: 'text' }],
  rows: [['Sul']],
  rowCount: 1,
  truncated: false,
  durationMs: 3,
};

describe('applyAnswerEvent', () => {
  it('builds the answer from the stream events, in order', () => {
    let answer = newAnswer('local-1');
    answer = applyAnswerEvent(answer, { event: 'sql', data: { sql: 'SELECT bad', attempt: 1 } });
    answer = applyAnswerEvent(answer, { event: 'sql', data: { sql: 'SELECT good', attempt: 2 } });
    answer = applyAnswerEvent(answer, {
      event: 'rows',
      data: { result: RESULT, visualization: { type: 'table' } },
    });
    answer = applyAnswerEvent(answer, { event: 'token', data: { text: 'O Sul ' } });
    answer = applyAnswerEvent(answer, { event: 'token', data: { text: 'lidera.' } });
    answer = applyAnswerEvent(answer, {
      event: 'done',
      data: {
        messageId: '42',
        status: 'answered',
        attempts: 2,
        usage: { inputTokens: 1, outputTokens: 1, calls: 3 },
      },
    });

    expect(answer).toEqual({
      kind: 'answer',
      id: 'local-1',
      messageId: '42',
      status: 'answered',
      sqlAttempts: ['SELECT bad', 'SELECT good'],
      result: RESULT,
      visualization: { type: 'table' },
      rowCount: 1,
      explanation: 'O Sul lidera.',
      fromHistory: false,
    });
  });

  it('records the error of an error event', () => {
    const answer = applyAnswerEvent(newAnswer('local-1'), {
      event: 'error',
      data: {
        code: 'QUERY_REJECTED',
        message: 'A consulta foi recusada.',
        details: [{ field: 'sql', message: 'Tabela não disponível.' }],
      },
    });

    expect(answer).toMatchObject({
      status: 'error',
      error: {
        message: 'A consulta foi recusada.',
        details: [{ field: 'sql', message: 'Tabela não disponível.' }],
      },
    });
  });
});

describe('itemsFromMessages', () => {
  it('turns the stored history into questions and answers', () => {
    const items = itemsFromMessages([
      { id: '1', role: 'user', content: 'Quais regiões?', createdAt: '2026-10-03T10:00:00.000Z' },
      {
        id: '2',
        role: 'assistant',
        content: 'São cinco.',
        status: 'answered',
        sql: 'SELECT name FROM regions',
        visualization: { type: 'table' },
        rowCount: 5,
        createdAt: '2026-10-03T10:00:01.000Z',
      },
      { id: '3', role: 'user', content: 'E o estoque?', createdAt: '2026-10-03T10:01:00.000Z' },
      {
        id: '4',
        role: 'assistant',
        content: 'O serviço de IA está indisponível no momento.',
        status: 'error',
        createdAt: '2026-10-03T10:01:01.000Z',
      },
    ]);

    expect(items).toEqual([
      { kind: 'question', id: '1', text: 'Quais regiões?' },
      {
        kind: 'answer',
        id: '2',
        messageId: '2',
        status: 'answered',
        sqlAttempts: ['SELECT name FROM regions'],
        explanation: 'São cinco.',
        visualization: { type: 'table' },
        rowCount: 5,
        fromHistory: true,
      },
      { kind: 'question', id: '3', text: 'E o estoque?' },
      {
        kind: 'answer',
        id: '4',
        messageId: '4',
        status: 'error',
        sqlAttempts: [],
        explanation: '',
        error: { message: 'O serviço de IA está indisponível no momento.' },
        fromHistory: true,
      },
    ]);
  });
});
