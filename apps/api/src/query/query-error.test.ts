import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import { describeErrorForLog, QueryExecutionError, translateDatabaseError } from './query-error.js';

function databaseError(sqlState: string, message: string): DatabaseError {
  const error = new DatabaseError(message, message.length, 'error');
  error.code = sqlState;
  return error;
}

describe('translateDatabaseError', () => {
  it.each([
    ['57014', 'QUERY_TIMEOUT'],
    ['42501', 'QUERY_NOT_ALLOWED'],
    ['25006', 'QUERY_NOT_ALLOWED'],
    ['42601', 'QUERY_SYNTAX_ERROR'],
    ['42P01', 'QUERY_INVALID_REFERENCE'],
    ['42703', 'QUERY_INVALID_REFERENCE'],
    ['42883', 'QUERY_INVALID_REFERENCE'],
    ['22012', 'QUERY_DATA_ERROR'],
    ['22P02', 'QUERY_DATA_ERROR'],
    ['08006', 'DATABASE_UNAVAILABLE'],
    ['28P01', 'DATABASE_UNAVAILABLE'],
    ['53300', 'DATABASE_UNAVAILABLE'],
    ['57P01', 'DATABASE_UNAVAILABLE'],
    ['XX000', 'QUERY_FAILED'],
  ])('maps SQLSTATE %s to %s', (sqlState, code) => {
    expect(translateDatabaseError(databaseError(sqlState, 'boom')).code).toBe(code);
  });

  it('passes on the PostgreSQL message for syntax and reference errors', () => {
    const translated = translateDatabaseError(
      databaseError('42703', 'column "totl" does not exist'),
    );

    expect(translated.details).toEqual([{ field: 'sql', message: 'column "totl" does not exist' }]);
  });

  it.each(['22P02', '42501', 'XX000', '28P01'])(
    'drops the PostgreSQL message for SQLSTATE %s',
    (sqlState) => {
      const translated = translateDatabaseError(
        databaseError(sqlState, 'invalid input syntax for type integer: "secret-value"'),
      );

      expect(translated.details).toBeUndefined();
      expect(translated.message).not.toContain('secret-value');
    },
  );

  it('treats a non-PostgreSQL failure as database unavailable', () => {
    const translated = translateDatabaseError(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    expect(translated.code).toBe('DATABASE_UNAVAILABLE');
    expect(translated.message).not.toContain('10.0.0.5');
  });

  it('returns an already translated error unchanged', () => {
    const original = new QueryExecutionError('QUERY_TIMEOUT');

    expect(translateDatabaseError(original)).toBe(original);
  });
});

describe('describeErrorForLog', () => {
  it('logs only the SQLSTATE of a PostgreSQL error', () => {
    const description = describeErrorForLog(databaseError('22P02', 'value "secret-value"'));

    expect(description).toBe('sqlstate=22P02');
  });

  it('logs only the code of a Node error', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
      code: 'ECONNREFUSED',
    });

    expect(describeErrorForLog(error)).toBe('code=ECONNREFUSED');
  });
});
