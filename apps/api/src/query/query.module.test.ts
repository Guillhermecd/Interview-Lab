import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../config/env.js';
import { DatabaseHealth } from './database-health.service.js';
import { GuardedQueryService } from './guarded-query.service.js';
import { QueryModule } from './query.module.js';
import { SchemaCatalog } from './schema-catalog.service.js';

const ENV: AppEnv = {
  port: 3000,
  database: {
    host: 'localhost',
    port: 5432,
    name: 'interview_lab',
    readonlyPassword: 'readonly-secret',
    poolMax: 1,
  },
  query: {
    maxRows: 1000,
    statementTimeoutMs: 5000,
    appTimeoutMs: 7000,
    internalEndpointEnabled: false,
  },
  llm: {
    geminiApiKey: undefined,
    model: 'test-model',
    timeoutMs: 5000,
    explainMaxRows: 50,
  },
};

// The security boundary of the module: the pool and the unguarded executor must
// never be exported, or another module could run SQL around the guard.
describe('QueryModule', () => {
  it('exports only the guarded query service, the health check and the schema description', () => {
    expect(QueryModule.register(ENV).exports).toEqual([
      GuardedQueryService,
      DatabaseHealth,
      SchemaCatalog,
    ]);
  });

  it('registers no controller unless the internal endpoint is enabled', () => {
    expect(QueryModule.register(ENV).controllers).toEqual([]);
  });

  it('registers the internal controller when the endpoint is enabled', () => {
    const enabled = { ...ENV, query: { ...ENV.query, internalEndpointEnabled: true } };

    expect(QueryModule.register(enabled).controllers).toHaveLength(1);
  });
});
