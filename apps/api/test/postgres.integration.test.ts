import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const POSTGRES_IMAGE = 'postgres:17-alpine';

// Proves the integration pipeline (Docker + Testcontainers) works locally and in CI.
// A database driver is only chosen in Phase 02, so the query goes through psql.
describe('PostgreSQL container', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  });

  afterAll(async () => {
    await container.stop();
  });

  it('runs PostgreSQL 17 and answers a query', async () => {
    const result = await container.exec([
      'psql',
      '-U',
      container.getUsername(),
      '-d',
      container.getDatabase(),
      '-tAc',
      'SHOW server_version_num',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toMatch(/^17\d{4}$/);
  });
});
