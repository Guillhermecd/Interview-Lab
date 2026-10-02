import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { ClientConfig } from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));
// Kept in its own schema so the migration history stays out of app_readonly's reach.
const MIGRATIONS_SCHEMA = 'migrations';
const MIGRATIONS_TABLE = 'pgmigrations';

export type MigrationLog = (message: string) => void;

interface MigrationOptions {
  connection: ClientConfig;
  log: MigrationLog;
}

function runMigrations(direction: 'up' | 'down', count: number, options: MigrationOptions) {
  return runner({
    databaseUrl: options.connection,
    dir: MIGRATIONS_DIR,
    direction,
    count,
    migrationsTable: MIGRATIONS_TABLE,
    migrationsSchema: MIGRATIONS_SCHEMA,
    createMigrationsSchema: true,
    log: options.log,
  });
}

export async function migrateUp(options: MigrationOptions): Promise<void> {
  await runMigrations('up', Infinity, options);
}

export async function migrateDown(options: MigrationOptions): Promise<void> {
  await runMigrations('down', Infinity, options);
}
