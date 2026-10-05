import type { QueryResult } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import type { AnswerEvent } from '../../api/modules/conversation.service';
import {
  applyAnswerEvent,
  cancelReview,
  editReviewDraft,
  newAnswer,
  reopenReview,
  startReviewExecution,
  type AnswerItem,
} from './chat-state';
import { messageState, messageSteps, sqlBlockView } from './message-state';

const STARTED_AT = '2026-10-05T12:00:00.000Z';
const SQL = 'SELECT name FROM regions';
const USAGE = { inputTokens: 10, outputTokens: 5, calls: 2 };

function result(rowCount: number): QueryResult {
  return {
    columns: [{ name: 'regiao', type: 'text' }],
    rows: Array.from({ length: rowCount }, () => ['Sul']),
    rowCount,
    truncated: false,
    durationMs: 3,
  };
}

const SQL_EVENT: AnswerEvent = { event: 'sql', data: { sql: SQL, attempt: 1 } };
const REVIEW_EVENT: AnswerEvent = {
  event: 'review',
  data: { messageId: '7', sql: SQL, tables: [] },
};
const TOKEN_EVENT: AnswerEvent = { event: 'token', data: { text: 'Cinco.' } };
const DONE_EVENT: AnswerEvent = {
  event: 'done',
  data: { messageId: '7', status: 'answered', attempts: 1, usage: USAGE },
};

function rowsEvent(rowCount: number): AnswerEvent {
  return { event: 'rows', data: { result: result(rowCount), visualization: { type: 'table' } } };
}

function errorEvent(code: string): AnswerEvent {
  return { event: 'error', data: { code, message: 'Falhou.' } };
}

function after(...events: AnswerEvent[]): AnswerItem {
  return events.reduce(applyAnswerEvent, newAnswer('a', STARTED_AT));
}

function stepLabels(answer: AnswerItem): string[] {
  return messageSteps(answer).map((step) => `${step.label}:${step.status}`);
}

describe('messageState transitions', () => {
  it('goes generating → running → streaming → done without review', () => {
    expect(messageState(after())).toBe('generating');
    expect(messageState(after(SQL_EVENT))).toBe('running');
    expect(messageState(after(SQL_EVENT, rowsEvent(2)))).toBe('streaming');
    expect(messageState(after(SQL_EVENT, rowsEvent(2), TOKEN_EVENT))).toBe('streaming');
    expect(messageState(after(SQL_EVENT, rowsEvent(2), TOKEN_EVENT, DONE_EVENT))).toBe('done');
  });

  it('stops at review when review is on, and runs only after approval', () => {
    const pending = after(SQL_EVENT, REVIEW_EVENT);
    expect(messageState(pending)).toBe('review');

    const approved = startReviewExecution(pending, SQL);
    expect(messageState(approved)).toBe('running');

    const streaming = applyAnswerEvent(approved, rowsEvent(2));
    expect(messageState(streaming)).toBe('streaming');
    expect(messageState(applyAnswerEvent(streaming, DONE_EVENT))).toBe('done');
  });

  it('goes to cancelled when the review is cancelled, and back to review', () => {
    const cancelled = cancelReview(after(SQL_EVENT, REVIEW_EVENT));
    expect(messageState(cancelled)).toBe('cancelled');
    expect(messageState(reopenReview(cancelled))).toBe('review');
  });

  it('ends as empty when the query returns no rows', () => {
    expect(messageState(after(SQL_EVENT, rowsEvent(0), TOKEN_EVENT, DONE_EVENT))).toBe('empty');
  });

  it('ends as blocked when the generated SQL is refused', () => {
    expect(messageState(after(SQL_EVENT, errorEvent('QUERY_REJECTED')))).toBe('blocked');
    expect(messageState(after(SQL_EVENT, errorEvent('QUERY_NOT_ALLOWED')))).toBe('blocked');
  });

  it('goes back to review when the approved SQL is refused', () => {
    const approved = startReviewExecution(after(SQL_EVENT, REVIEW_EVENT), 'DELETE FROM regions');

    expect(messageState(applyAnswerEvent(approved, errorEvent('QUERY_REJECTED')))).toBe('review');
  });

  it('ends as timeout when the query runs out of time', () => {
    expect(messageState(after(SQL_EVENT, errorEvent('QUERY_TIMEOUT')))).toBe('timeout');
  });

  it('tells the usage limits apart by the error code', () => {
    expect(messageState(after(errorEvent('RATE_LIMITED')))).toBe('ratelimit');
    expect(messageState(after(errorEvent('QUOTA_EXCEEDED')))).toBe('quota');
  });

  it('treats any other failure as a plain error', () => {
    expect(messageState(after(errorEvent('LLM_UNAVAILABLE')))).toBe('error');
  });

  it('ends as not answerable when the AI declines', () => {
    const declined = after(TOKEN_EVENT, {
      event: 'done',
      data: { messageId: '7', status: 'not_answerable', attempts: 0, usage: USAGE },
    });

    expect(messageState(declined)).toBe('not_answerable');
  });
});

describe('messageSteps', () => {
  it('follows the sequence of a direct answer, without a review step', () => {
    expect(stepLabels(after())).toEqual([
      'SQL:current',
      'Execução:todo',
      'Resultado:todo',
      'Explicação:todo',
    ]);
    expect(stepLabels(after(SQL_EVENT))).toEqual([
      'SQL:done',
      'Execução:current',
      'Resultado:todo',
      'Explicação:todo',
    ]);
    expect(stepLabels(after(SQL_EVENT, rowsEvent(2)))).toEqual([
      'SQL:done',
      'Execução:done',
      'Resultado:done',
      'Explicação:current',
    ]);
    expect(stepLabels(after(SQL_EVENT, rowsEvent(2), DONE_EVENT))).toEqual([
      'SQL:done',
      'Execução:done',
      'Resultado:done',
      'Explicação:done',
    ]);
  });

  it('waits at the review step in review mode', () => {
    const pending = after(SQL_EVENT, REVIEW_EVENT);

    expect(stepLabels(pending)).toEqual([
      'SQL:done',
      'Aguardando revisão:current',
      'Execução:todo',
      'Resultado:todo',
      'Explicação:todo',
    ]);
    expect(stepLabels(cancelReview(pending))[1]).toBe('Cancelado:current');
    expect(stepLabels(startReviewExecution(pending, SQL))).toEqual([
      'SQL:done',
      'Revisão:done',
      'Execução:current',
      'Resultado:todo',
      'Explicação:todo',
    ]);
  });

  it('marks where it failed and leaves the rest undone', () => {
    expect(stepLabels(after(SQL_EVENT, errorEvent('QUERY_REJECTED')))).toEqual([
      'SQL:error',
      'Execução:todo',
      'Resultado:todo',
      'Explicação:todo',
    ]);
    expect(stepLabels(after(SQL_EVENT, errorEvent('QUERY_TIMEOUT')))).toEqual([
      'SQL:done',
      'Execução:error',
      'Resultado:todo',
      'Explicação:todo',
    ]);
  });

  it('shows no steps when the question never became a query', () => {
    expect(messageSteps(after(errorEvent('RATE_LIMITED')))).toEqual([]);
    expect(messageSteps(after(errorEvent('QUOTA_EXCEEDED')))).toEqual([]);
    expect(messageSteps({ ...after(), status: 'cancelled' })).toEqual([]);
  });
});

describe('sqlBlockView', () => {
  it('has nothing to show before any SQL, except while generating', () => {
    expect(sqlBlockView(after())).toEqual({
      sql: '',
      mode: 'generating',
      status: undefined,
      edited: false,
    });
    expect(sqlBlockView(after(errorEvent('RATE_LIMITED')))).toBeUndefined();
  });

  it('offers the generated SQL for review as validated', () => {
    expect(sqlBlockView(after(SQL_EVENT, REVIEW_EVENT))).toEqual({
      sql: SQL,
      mode: 'review',
      status: 'validated',
      edited: false,
    });
  });

  it('shows an edited draft as not validated yet', () => {
    const edited = editReviewDraft(after(SQL_EVENT, REVIEW_EVENT), `${SQL} LIMIT 1`);

    expect(sqlBlockView(edited)).toEqual({
      sql: `${SQL} LIMIT 1`,
      mode: 'review',
      status: undefined,
      edited: true,
    });
  });

  it('shows the refused draft as blocked, under review again', () => {
    const refused = applyAnswerEvent(
      startReviewExecution(after(SQL_EVENT, REVIEW_EVENT), 'DELETE FROM regions'),
      errorEvent('QUERY_REJECTED'),
    );

    expect(sqlBlockView(refused)).toEqual({
      sql: 'DELETE FROM regions',
      mode: 'review',
      status: 'blocked',
      edited: true,
    });
  });

  it('does not call validated a SQL that is still running in direct mode', () => {
    expect(sqlBlockView(after(SQL_EVENT))).toMatchObject({ mode: 'running', status: undefined });
  });

  it('shows the SQL of a finished answer as validated, and of a refused one as blocked', () => {
    expect(sqlBlockView(after(SQL_EVENT, rowsEvent(1), DONE_EVENT))).toMatchObject({
      mode: 'view',
      status: 'validated',
    });
    expect(sqlBlockView(after(SQL_EVENT, errorEvent('QUERY_REJECTED')))).toMatchObject({
      mode: 'view',
      status: 'blocked',
    });
    expect(sqlBlockView(after(SQL_EVENT, errorEvent('LLM_UNAVAILABLE')))).toMatchObject({
      mode: 'view',
      status: undefined,
    });
  });
});
