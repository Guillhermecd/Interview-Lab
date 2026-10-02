import { describe, expect, it } from 'vitest';
import { InvalidEnvError } from './env-parsers.js';
import { loadEnv } from './env.js';

const REQUIRED_ENV = {
  DB_HOST: 'localhost',
  DB_NAME: 'interview_lab',
  DB_READONLY_PASSWORD: 'readonly-secret',
  DB_APP_PASSWORD: 'app-secret',
};

describe('loadEnv', () => {
  it('applies the defaults when only the required variables are set', () => {
    expect(loadEnv(REQUIRED_ENV)).toEqual({
      port: 3000,
      database: {
        host: 'localhost',
        port: 5432,
        name: 'interview_lab',
        readonlyPassword: 'readonly-secret',
        poolMax: 10,
      },
      appDatabase: {
        host: 'localhost',
        port: 5432,
        name: 'interview_lab',
        appPassword: 'app-secret',
        poolMax: 10,
      },
      query: {
        maxRows: 1000,
        statementTimeoutMs: 5000,
        appTimeoutMs: 7000,
        internalEndpointEnabled: false,
      },
      llm: {
        geminiApiKey: undefined,
        model: 'gemini-3.5-flash-lite',
        timeoutMs: 30_000,
        explainMaxRows: 50,
      },
    });
  });

  it('reads the LLM variables', () => {
    const env = loadEnv({
      ...REQUIRED_ENV,
      GEMINI_API_KEY: 'test-key',
      LLM_MODEL: 'gemini-3.8-flash',
      LLM_TIMEOUT_MS: '10000',
      LLM_EXPLAIN_MAX_ROWS: '20',
    });

    expect(env.llm).toEqual({
      geminiApiKey: 'test-key',
      model: 'gemini-3.8-flash',
      timeoutMs: 10_000,
      explainMaxRows: 20,
    });
  });

  it('starts without an LLM key', () => {
    expect(loadEnv({ ...REQUIRED_ENV, GEMINI_API_KEY: '' }).llm.geminiApiKey).toBeUndefined();
  });

  it('reads every optional variable', () => {
    const env = loadEnv({
      ...REQUIRED_ENV,
      PORT: '8080',
      DB_PORT: '5433',
      DB_POOL_MAX: '4',
      QUERY_MAX_ROWS: '50',
      QUERY_STATEMENT_TIMEOUT_MS: '1000',
      QUERY_APP_TIMEOUT_MS: '2000',
      INTERNAL_QUERY_ENDPOINT_ENABLED: 'true',
    });

    expect(env.port).toBe(8080);
    expect(env.database.port).toBe(5433);
    expect(env.database.poolMax).toBe(4);
    expect(env.query).toEqual({
      maxRows: 50,
      statementTimeoutMs: 1000,
      appTimeoutMs: 2000,
      internalEndpointEnabled: true,
    });
  });

  it.each(['abc', '0', '70000', '80.5'])('rejects invalid PORT "%s"', (rawPort) => {
    expect(() => loadEnv({ ...REQUIRED_ENV, PORT: rawPort })).toThrow(InvalidEnvError);
  });

  it.each(['DB_HOST', 'DB_NAME', 'DB_READONLY_PASSWORD', 'DB_APP_PASSWORD'])(
    'rejects a missing %s',
    (variable) => {
      expect(() => loadEnv({ ...REQUIRED_ENV, [variable]: '' })).toThrow(InvalidEnvError);
    },
  );

  it.each([
    ['QUERY_MAX_ROWS', '0'],
    ['QUERY_MAX_ROWS', '10001'],
    ['QUERY_STATEMENT_TIMEOUT_MS', '50'],
    ['DB_POOL_MAX', '0'],
    ['LLM_TIMEOUT_MS', '10'],
    ['LLM_EXPLAIN_MAX_ROWS', '0'],
    ['INTERNAL_QUERY_ENDPOINT_ENABLED', 'yes'],
  ])('rejects %s=%s', (variable, value) => {
    expect(() => loadEnv({ ...REQUIRED_ENV, [variable]: value })).toThrow(InvalidEnvError);
  });

  it('rejects an application timeout that is not above the statement timeout', () => {
    expect(() =>
      loadEnv({
        ...REQUIRED_ENV,
        QUERY_STATEMENT_TIMEOUT_MS: '5000',
        QUERY_APP_TIMEOUT_MS: '5000',
      }),
    ).toThrow(InvalidEnvError);
  });

  it('never asks for admin credentials', () => {
    expect(() => loadEnv(REQUIRED_ENV)).not.toThrow();
  });
});
