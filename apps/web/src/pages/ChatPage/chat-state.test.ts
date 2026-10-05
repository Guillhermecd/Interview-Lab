import type { QueryResult } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import {
  applyAnswerEvent,
  cancelReview,
  editReviewDraft,
  itemsFromMessages,
  lastTablesUsed,
  newAnswer,
  reopenReview,
  startReviewExecution,
  type ChatItem,
} from './chat-state';

const STARTED_AT = '2026-10-05T12:00:00.000Z';

const RESULT: QueryResult = {
  columns: [{ name: 'regiao', type: 'text' }],
  rows: [['Sul']],
  rowCount: 1,
  truncated: false,
  durationMs: 3,
};

describe('applyAnswerEvent', () => {
  it('builds the answer from the stream events, in order', () => {
    let answer = newAnswer('local-1', STARTED_AT);
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
        cached: true,
      },
    });

    expect(answer).toEqual({
      kind: 'answer',
      id: 'local-1',
      messageId: '42',
      status: 'answered',
      time: STARTED_AT,
      usage: { inputTokens: 1, outputTokens: 1, calls: 3 },
      cached: true,
      sqlAttempts: ['SELECT bad', 'SELECT good'],
      result: RESULT,
      visualization: { type: 'table' },
      rowCount: 1,
      explanation: 'O Sul lidera.',
      fromHistory: false,
      executingReview: false,
    });
  });

  it('records the error of an error event', () => {
    const answer = applyAnswerEvent(newAnswer('local-1', STARTED_AT), {
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
        code: 'QUERY_REJECTED',
        message: 'A consulta foi recusada.',
        details: [{ field: 'sql', message: 'Tabela não disponível.' }],
      },
    });
  });

  it('keeps how long to wait when a usage limit refuses the question', () => {
    const answer = applyAnswerEvent(newAnswer('local-1', STARTED_AT), {
      event: 'error',
      data: { code: 'RATE_LIMITED', message: 'Muitas requisições.', retryAfterSeconds: 42 },
    });

    expect(answer.error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 42 });
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
      { kind: 'question', id: '1', text: 'Quais regiões?', time: '2026-10-03T10:00:00.000Z' },
      {
        kind: 'answer',
        id: '2',
        messageId: '2',
        status: 'answered',
        time: '2026-10-03T10:00:01.000Z',
        sqlAttempts: ['SELECT name FROM regions'],
        explanation: 'São cinco.',
        visualization: { type: 'table' },
        rowCount: 5,
        fromHistory: true,
      },
      { kind: 'question', id: '3', text: 'E o estoque?', time: '2026-10-03T10:01:00.000Z' },
      {
        kind: 'answer',
        id: '4',
        messageId: '4',
        status: 'error',
        time: '2026-10-03T10:01:01.000Z',
        sqlAttempts: [],
        explanation: '',
        error: { message: 'O serviço de IA está indisponível no momento.' },
        fromHistory: true,
      },
    ]);
  });
});

describe('review mode state', () => {
  const REVIEW_SQL = 'SELECT name FROM regions';

  function pendingAnswer() {
    return applyAnswerEvent(newAnswer('local-1', STARTED_AT), {
      event: 'review',
      data: { messageId: '7', sql: REVIEW_SQL, tables: ['regions'] },
    });
  }

  it('keeps the SQL to review and the message id', () => {
    expect(pendingAnswer()).toMatchObject({
      status: 'pending_review',
      messageId: '7',
      reviewSql: REVIEW_SQL,
      sqlAttempts: [REVIEW_SQL],
    });
  });

  it('goes back to review, keeping the draft, when the executed SQL is refused', () => {
    const executing = startReviewExecution(pendingAnswer(), 'DELETE FROM regions');

    const refused = applyAnswerEvent(executing, {
      event: 'error',
      data: { code: 'QUERY_REJECTED', message: 'Recusada.' },
    });

    expect(refused).toMatchObject({
      status: 'pending_review',
      reviewSql: REVIEW_SQL,
      reviewDraft: 'DELETE FROM regions',
      executingReview: false,
      error: { code: 'QUERY_REJECTED', message: 'Recusada.' },
    });
  });

  it('drops what the server said about a draft once the user changes it', () => {
    const refused = applyAnswerEvent(startReviewExecution(pendingAnswer(), 'DELETE FROM regions'), {
      event: 'error',
      data: { code: 'QUERY_REJECTED', message: 'Recusada.' },
    });

    const edited = editReviewDraft(refused, 'SELECT 1');
    expect(edited.reviewDraft).toBe('SELECT 1');
    expect(edited.error).toBeUndefined();

    const undone = editReviewDraft(edited, undefined);
    expect(undone.reviewDraft).toBeUndefined();
    expect(undone.reviewSql).toBe(REVIEW_SQL);
  });

  it('cancels a pending review on screen and lets it be reviewed again', () => {
    const cancelled = cancelReview(pendingAnswer());
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.messageId).toBe('7');

    expect(reopenReview(cancelled).status).toBe('pending_review');
  });

  it('does not reopen an answer that was stopped outside review mode', () => {
    const stopped = { ...newAnswer('local-2', STARTED_AT), status: 'cancelled' as const };

    expect(reopenReview(stopped).status).toBe('cancelled');
    expect(cancelReview(stopped).status).toBe('cancelled');
  });

  it('records the generated SQL when the user edited it', () => {
    const executing = startReviewExecution(pendingAnswer(), `${REVIEW_SQL} LIMIT 1`);

    const done = applyAnswerEvent(executing, {
      event: 'done',
      data: {
        messageId: '7',
        status: 'answered',
        attempts: 1,
        usage: { inputTokens: 1, outputTokens: 1, calls: 1 },
        edited: true,
      },
    });

    expect(done).toMatchObject({
      status: 'answered',
      edited: true,
      generatedSql: REVIEW_SQL,
      sqlAttempts: [`${REVIEW_SQL} LIMIT 1`],
    });
  });
});

describe('tables an answer was based on', () => {
  const DONE = {
    messageId: '9',
    status: 'answered' as const,
    attempts: 1,
    usage: { inputTokens: 1, outputTokens: 1, calls: 2 },
  };

  it('come with the SQL to review and are replaced by the ones of the SQL that ran', () => {
    const pending = applyAnswerEvent(newAnswer('local-1', STARTED_AT), {
      event: 'review',
      data: { messageId: '9', sql: 'SELECT name FROM regions', tables: ['regions'] },
    });
    expect(pending.tables).toEqual(['regions']);

    const done = applyAnswerEvent(startReviewExecution(pending, 'SELECT id FROM orders'), {
      event: 'done',
      data: { ...DONE, edited: true, tables: ['orders'] },
    });
    expect(done.tables).toEqual(['orders']);
  });

  it('are absent when the server sent none', () => {
    const done = applyAnswerEvent(newAnswer('local-1', STARTED_AT), {
      event: 'done',
      data: { ...DONE, status: 'not_answerable' },
    });

    expect(done).not.toHaveProperty('tables');
  });

  it('are read from the history', () => {
    const items = itemsFromMessages([
      { id: '1', role: 'user', content: 'Pedidos por região?', createdAt: STARTED_AT },
      {
        id: '2',
        role: 'assistant',
        content: 'Cinco regiões.',
        status: 'answered',
        sql: 'SELECT 1',
        tables: ['orders', 'regions'],
        createdAt: STARTED_AT,
      },
    ]);

    expect(items[1]).toMatchObject({ tables: ['orders', 'regions'] });
    expect(items[0]).not.toHaveProperty('tables');
  });

  it('the last query of the conversation is the one the schema panel marks', () => {
    const answered = (id: string, tables?: string[]): ChatItem => ({
      ...newAnswer(id, STARTED_AT),
      status: 'answered',
      ...(tables && { tables }),
    });

    expect(lastTablesUsed([])).toEqual([]);
    expect(lastTablesUsed([answered('a', ['orders']), answered('b', ['regions'])])).toEqual([
      'regions',
    ]);
    // An answer without a query (not answerable, failed) keeps the previous mark.
    expect(lastTablesUsed([answered('a', ['orders']), answered('b'), answered('c', [])])).toEqual([
      'orders',
    ]);
  });
});
