import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, type ClientConfig } from 'pg';
import { migrateUp } from '../../src/database/migrate.js';
import { provisionRolePasswords } from '../../src/database/provision-roles.js';
import { APP_ROLE, READONLY_ROLE } from '../../src/database/roles.js';

const POSTGRES_IMAGE = 'postgres:17-alpine';
const READONLY_TEST_PASSWORD = 'readonly-test-password';
const APP_TEST_PASSWORD = 'app-test-password';

export interface TestDatabase {
  admin: ClientConfig;
  readonly: ClientConfig;
  app: ClientConfig;
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
