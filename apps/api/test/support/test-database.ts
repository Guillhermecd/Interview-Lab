import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, type ClientConfig } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { AppEnv, QueryEnv } from '../../src/config/env.js';
import type { LimitsEnv } from '../../src/config/security-env.js';
import { migrateUp } from '../../src/database/migrate.js';
import { provisionRolePasswords } from '../../src/database/provision-roles.js';
import { APP_ROLE, READONLY_ROLE } from '../../src/database/roles.js';

const POSTGRES_IMAGE = 'postgres:17-alpine';
const REDIS_IMAGE = 'redis:7-alpine';
const REDIS_PORT = 6379;
const READONLY_TEST_PASSWORD = 'readonly-test-password';
const APP_TEST_PASSWORD = 'app-test-password';
const TEST_POOL_MAX = 4;
// Nothing listens here: tests that need Redis start it with { redis: true }.
const NO_REDIS_URL = 'redis://127.0.0.1:1';

export const TEST_ALLOWED_ORIGIN = 'http://localhost:5173';

const DEFAULT_TEST_QUERY_ENV: QueryEnv = {
  maxRows: 1000,
  statementTimeoutMs: 5000,
  appTimeoutMs: 7000,
  internalEndpointEnabled: false,
};

const DEFAULT_TEST_LIMITS: LimitsEnv = {
  questionsPerMinute: 1000,
  dailyTokenQuota: 10_000_000,
  loginAttemptsPerMinute: 1000,
  sqlCacheTtlSeconds: 0,
  resultCacheTtlSeconds: 0,
};

export interface TestEnvOptions {
  query?: Partial<QueryEnv>;
  limits?: Partial<LimitsEnv>;
}

export interface TestDatabase {
  admin: ClientConfig;
  readonly: ClientConfig;
  app: ClientConfig;
  // What the API needs to reach this database (and Redis, when started).
  appEnv: (query?: Partial<QueryEnv>, options?: Omit<TestEnvOptions, 'query'>) => AppEnv;
  stop: () => Promise<void>;
}

export function silentLog(): void {
  // Migration output is noise in test runs.
}

export async function withClient<T>(
  connection: ClientConfig,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(connection);
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

function connectionFor(container: StartedPostgreSqlContainer, user: string, password: string) {
  return {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user,
    password,
  };
}

async function startRedis(): Promise<StartedTestContainer> {
  return new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(REDIS_PORT)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
}

// Starts an empty PostgreSQL 17 (and Redis, if asked). Tests that need the
// schema call migrateTestDatabase.
export async function startTestDatabase(options: { redis?: boolean } = {}): Promise<TestDatabase> {
  const [container, redis] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    options.redis === true ? startRedis() : Promise.resolve(undefined),
  ]);
  const redisUrl = redis
    ? `redis://${redis.getHost()}:${String(redis.getMappedPort(REDIS_PORT))}`
    : NO_REDIS_URL;

  return {
    admin: connectionFor(container, container.getUsername(), container.getPassword()),
    readonly: connectionFor(container, READONLY_ROLE, READONLY_TEST_PASSWORD),
    app: connectionFor(container, APP_ROLE, APP_TEST_PASSWORD),
    appEnv: (query = {}, envOptions = {}) => ({
      port: 0,
      database: {
        host: container.getHost(),
        port: container.getPort(),
        name: container.getDatabase(),
        readonlyPassword: READONLY_TEST_PASSWORD,
        poolMax: TEST_POOL_MAX,
      },
      appDatabase: {
        host: container.getHost(),
        port: container.getPort(),
        name: container.getDatabase(),
        appPassword: APP_TEST_PASSWORD,
        poolMax: TEST_POOL_MAX,
      },
      query: { ...DEFAULT_TEST_QUERY_ENV, ...query },
      llm: {
        geminiApiKey: undefined,
        model: 'test-model',
        timeoutMs: 5000,
        explainMaxRows: 50,
      },
      auth: {
        jwtSecret: 'integration-test-secret-with-32-chars!!',
        jwtExpiresInSeconds: 3600,
        secureCookies: false,
        allowedOrigins: [TEST_ALLOWED_ORIGIN],
      },
      redis: { url: redisUrl },
      limits: { ...DEFAULT_TEST_LIMITS, ...envOptions.limits },
    }),
    stop: async () => {
      await Promise.all([container.stop(), redis?.stop()]);
    },
  };
}

export async function migrateTestDatabase(database: TestDatabase): Promise<void> {
  await migrateUp({ connection: database.admin, log: silentLog });
  await withClient(database.admin, (client) =>
    provisionRolePasswords(client, {
      readonlyPassword: READONLY_TEST_PASSWORD,
      appPassword: APP_TEST_PASSWORD,
    }),
  );
}
