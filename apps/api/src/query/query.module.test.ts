import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../config/env.js';
import { DatabaseHealth } from './database-health.service.js';
import { FixedReadQuery } from './fixed-read-query.service.js';
import { GuardedQueryService } from './guarded-query.service.js';
import { QueryExecutor } from './query-executor.service.js';
import { QueryModule } from './query.module.js';
import { FIXED_READ_POOL, READONLY_POOL } from './query.tokens.js';
import { QueryController } from './query.controller.js';
import { SchemaCatalog } from './schema-catalog.service.js';
import { SchemaController } from './schema.controller.js';

const ENV: AppEnv = {
  port: 3000,
  database: {
    host: 'localhost',
    port: 5432,
    name: 'interview_lab',
    readonlyPassword: 'readonly-secret',
    poolMax: 1,
    fixedReadPoolMax: 1,
  },
  appDatabase: {
    host: 'localhost',
    port: 5432,
    name: 'interview_lab',
    appPassword: 'app-secret',
    poolMax: 1,
  },
  catalogDatabase: {
    host: 'localhost',
    port: 5432,
    name: 'interview_lab',
    catalogPassword: 'catalog-secret',
    poolMax: 1,
  },
  query: {
    maxRows: 1000,
    statementTimeoutMs: 5000,
    appTimeoutMs: 7000,
    maxCost: 500_000,
    internalEndpointEnabled: false,
  },
  llm: {
    geminiApiKey: undefined,
    model: 'test-model',
    timeoutMs: 5000,
    explainMaxRows: 50,
  },
  auth: {
    jwtSecret: 'test-secret-with-at-least-32-characters!',
    jwtExpiresInSeconds: 3600,
    secureCookies: false,
    allowedOrigins: ['http://localhost:5173'],
  },
  redis: { url: 'redis://localhost:6379' },
  limits: {
    questionsPerMinute: 10,
    dailyTokenQuota: 200_000,
    loginAttemptsPerMinute: 5,
    maxInflightPerUser: 1,
    sqlCacheTtlSeconds: 3600,
    resultCacheTtlSeconds: 300,
  },
  dashboard: { onTimeTargetPercent: 95 },
};

// The security boundary of the module: the pool and the unguarded executor must
// never be exported, or another module could run SQL around the guard.
// FixedReadQuery (D-54) is the one deliberate addition: it runs statements
// written in the code, with values as parameters, as the same read-only role.
describe('QueryModule', () => {
  it('exports only the guarded query service, the health check, the schema description and the fixed statements', () => {
    expect(QueryModule.register(ENV).exports).toEqual([
      GuardedQueryService,
      DatabaseHealth,
      SchemaCatalog,
      FixedReadQuery,
    ]);
  });

  it('never exports the pools or the unguarded executor', () => {
    const exported = QueryModule.register(ENV).exports ?? [];

    expect(exported).not.toContain(READONLY_POOL);
    expect(exported).not.toContain(FIXED_READ_POOL);
    expect(exported).not.toContain(QueryExecutor);
  });

  it('registers only the schema description unless the internal endpoint is enabled', () => {
    expect(QueryModule.register(ENV).controllers).toEqual([SchemaController]);
  });

  it('registers the internal controller when the endpoint is enabled', () => {
    const enabled = { ...ENV, query: { ...ENV.query, internalEndpointEnabled: true } };

    expect(QueryModule.register(enabled).controllers).toEqual([SchemaController, QueryController]);
  });
});
