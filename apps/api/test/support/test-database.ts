import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, type ClientConfig } from 'pg';
import type { AppEnv, QueryEnv } from '../../src/config/env.js';
import { migrateUp } from '../../src/database/migrate.js';
import { provisionRolePasswords } from '../../src/database/provision-roles.js';
import { APP_ROLE, READONLY_ROLE } from '../../src/database/roles.js';

const POSTGRES_IMAGE = 'postgres:17-alpine';
const READONLY_TEST_PASSWORD = 'readonly-test-password';
const APP_TEST_PASSWORD = 'app-test-password';
const TEST_POOL_MAX = 4;
const DEFAULT_TEST_QUERY_ENV: QueryEnv = {
  maxRows: 1000,
  statementTimeoutMs: 5000,
  appTimeoutMs: 7000,
  internalEndpointEnabled: false,
};

export interface TestDatabase {
  admin: ClientConfig;
  readonly: ClientConfig;
  app: ClientConfig;
  // What the API needs to reach this database as app_readonly.
  appEnv: (query?: Partial<QueryEnv>) => AppEnv;
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

// Starts an empty PostgreSQL 17. Tests that need the schema call migrateTestDatabase.
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();

  return {
    admin: connectionFor(container, container.getUsername(), container.getPassword()),
    readonly: connectionFor(container, READONLY_ROLE, READONLY_TEST_PASSWORD),
    app: connectionFor(container, APP_ROLE, APP_TEST_PASSWORD),
    appEnv: (query = {}) => ({
      port: 0,
      database: {
        host: container.getHost(),
        port: container.getPort(),
        name: container.getDatabase(),
        readonlyPassword: READONLY_TEST_PASSWORD,
        poolMax: TEST_POOL_MAX,
      },
      query: { ...DEFAULT_TEST_QUERY_ENV, ...query },
      llm: {
        geminiApiKey: undefined,
        model: 'test-model',
        timeoutMs: 5000,
        explainMaxRows: 50,
      },
    }),
    stop: async () => {
      await container.stop();
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
