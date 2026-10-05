import { describe, expect, it } from 'vitest';
import { InvalidEnvError } from './env-parsers.js';
import { loadEnv } from './env.js';

const REQUIRED_ENV = {
  DB_HOST: 'localhost',
  DB_NAME: 'interview_lab',
  DB_READONLY_PASSWORD: 'readonly-secret',
  DB_APP_PASSWORD: 'app-secret',
  JWT_SECRET: 'a-development-secret-with-32-characters',
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
      auth: {
        jwtSecret: 'a-development-secret-with-32-characters',
        jwtExpiresInSeconds: 86_400,
        secureCookies: false,
        allowedOrigins: ['http://localhost:5173'],
      },
      redis: { url: 'redis://localhost:6379' },
      limits: {
        questionsPerMinute: 10,
        dailyTokenQuota: 200_000,
        loginAttemptsPerMinute: 5,
        sqlCacheTtlSeconds: 3600,
        resultCacheTtlSeconds: 300,
      },
      dashboard: { onTimeTargetPercent: 95 },
    });
  });

  it('reads the on-time delivery target of the dashboard', () => {
    expect(loadEnv({ ...REQUIRED_ENV, ON_TIME_DELIVERY_TARGET_PERCENT: '90' }).dashboard).toEqual({
      onTimeTargetPercent: 90,
    });
    expect(() => loadEnv({ ...REQUIRED_ENV, ON_TIME_DELIVERY_TARGET_PERCENT: '0' })).toThrow(
      InvalidEnvError,
    );
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

describe('loadEnv security settings', () => {
  it('reads the authentication, Redis and limit variables', () => {
    const env = loadEnv({
      ...REQUIRED_ENV,
      JWT_EXPIRES_IN: '7200',
      ALLOWED_ORIGINS: 'https://app.example.com, http://localhost:5173',
      REDIS_URL: 'redis://cache:6379',
      RATE_LIMIT_PER_MINUTE: '3',
      DAILY_TOKEN_QUOTA: '1000',
      LOGIN_ATTEMPTS_PER_MINUTE: '2',
      SQL_CACHE_TTL_SECONDS: '0',
      RESULT_CACHE_TTL_SECONDS: '60',
    });

    expect(env.auth.jwtExpiresInSeconds).toBe(7200);
    expect(env.auth.allowedOrigins).toEqual(['https://app.example.com', 'http://localhost:5173']);
    expect(env.redis.url).toBe('redis://cache:6379');
    expect(env.limits).toEqual({
      questionsPerMinute: 3,
      dailyTokenQuota: 1000,
      loginAttemptsPerMinute: 2,
      sqlCacheTtlSeconds: 0,
      resultCacheTtlSeconds: 60,
    });
  });

  it('requires a JWT secret of at least 32 characters', () => {
    expect(() => loadEnv({ ...REQUIRED_ENV, JWT_SECRET: '' })).toThrow(InvalidEnvError);
    expect(() => loadEnv({ ...REQUIRED_ENV, JWT_SECRET: 'too-short' })).toThrow(InvalidEnvError);
  });

  it('refuses the example secret in production, but accepts it in development', () => {
    const example = 'change-me-to-a-long-random-secret-of-at-least-32-characters';

    expect(() => loadEnv({ ...REQUIRED_ENV, JWT_SECRET: example })).not.toThrow();
    expect(() => loadEnv({ ...REQUIRED_ENV, JWT_SECRET: example, NODE_ENV: 'production' })).toThrow(
      InvalidEnvError,
    );
  });

  it('uses secure cookies only in production', () => {
    expect(loadEnv(REQUIRED_ENV).auth.secureCookies).toBe(false);
    expect(loadEnv({ ...REQUIRED_ENV, NODE_ENV: 'production' }).auth.secureCookies).toBe(true);
  });

  it('rejects an empty list of allowed origins', () => {
    expect(() => loadEnv({ ...REQUIRED_ENV, ALLOWED_ORIGINS: ' , ' })).toThrow(InvalidEnvError);
  });
});
