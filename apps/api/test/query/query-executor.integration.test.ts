import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { QueryEnv } from '../../src/config/env.js';
import { seedDemoData } from '../../src/database/seed.js';
import { QueryExecutor } from '../../src/query/query-executor.service.js';
import { createReadonlyPool } from '../../src/query/readonly-pool.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const SHORT_TIMEOUT_MS = 300;
const LONG_TIMEOUT_MS = 20_000;
const TIMEOUT_TOLERANCE_MS = 2500;

describe('QueryExecutor', () => {
  let database: TestDatabase;
  const pools: Pool[] = [];

  function executorWith(query: Partial<QueryEnv> = {}): QueryExecutor {
    const env = database.appEnv(query);
    const pool = createReadonlyPool(env.database);
    pools.push(pool);
    return new QueryExecutor(pool, env.query);
  }

  async function runningSleepQueries(): Promise<number> {
    const result = await withClient(database.admin, (client) =>
      client.query<{ total: string }>(
        `SELECT count(*) AS total FROM pg_stat_activity
         WHERE usename = 'app_readonly' AND state = 'active' AND query LIKE '%pg_sleep%'`,
      ),
    );
    return Number(result.rows[0]?.total);
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    await migrateTestDatabase(database);
    await withClient(database.admin, async (client) => {
      await seedDemoData(client);
      await client.query('CREATE TABLE app.secrets (id bigint PRIMARY KEY, token text NOT NULL)');
    });
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  afterAll(async () => {
    await database.stop();
  });

  describe('successful execution', () => {
    it('returns columns with types, rows in column order and timing', async () => {
      const result = await executorWith().execute(
        'SELECT id, name FROM regions ORDER BY name LIMIT 2',
      );

      expect(result.columns).toEqual([
        { name: 'id', type: 'int8' },
        { name: 'name', type: 'text' },
      ]);
      expect(result.rows).toEqual([
        [expect.any(String), 'Centro-Oeste'],
        [expect.any(String), 'Nordeste'],
      ]);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('reports aggregate, numeric and timestamp column types', async () => {
      const result = await executorWith().execute(
        `SELECT count(*) AS orders, sum(unit_price) AS revenue, max(ordered_at) AS last_order
         FROM orders JOIN order_items ON order_items.order_id = orders.id`,
      );

      expect(result.columns).toEqual([
        { name: 'orders', type: 'int8' },
        { name: 'revenue', type: 'numeric' },
        { name: 'last_order', type: 'timestamptz' },
      ]);
      expect(result.rows[0]?.[2]).toBeInstanceOf(Date);
    });

    it('returns date and timestamp without time zone as written by PostgreSQL', async () => {
      const result = await executorWith().execute(
        "SELECT date '2026-09-02' AS dia, timestamp '2026-09-02 14:30:00' AS momento",
      );

      expect(result.columns).toEqual([
        { name: 'dia', type: 'date' },
        { name: 'momento', type: 'timestamp' },
      ]);
      expect(result.rows).toEqual([['2026-09-02', '2026-09-02 14:30:00']]);
    });

    it('keeps columns that share the same name', async () => {
      const result = await executorWith().execute(
        'SELECT regions.id, customers.id FROM regions JOIN customers ON customers.region_id = regions.id LIMIT 1',
      );

      expect(result.columns.map((column) => column.name)).toEqual(['id', 'id']);
      expect(result.rows[0]).toHaveLength(2);
    });

    it('accepts a trailing semicolon', async () => {
      const result = await executorWith().execute('SELECT 1 AS one;');

      expect(result.rows).toEqual([[1]]);
    });

    it('runs as app_readonly inside a read-only transaction', async () => {
      const result = await executorWith().execute(
        "SELECT current_user, current_setting('transaction_read_only')",
      );

      expect(result.rows).toEqual([['app_readonly', 'on']]);
    });
  });

  describe('row limit', () => {
    it('truncates at the limit and flags the result', async () => {
      const result = await executorWith({ maxRows: 10 }).execute('SELECT id FROM orders');

      expect(result.rows).toHaveLength(10);
      expect(result.rowCount).toBe(10);
      expect(result.truncated).toBe(true);
    });

    it('does not flag a result that has exactly the limit', async () => {
      const result = await executorWith({ maxRows: 5 }).execute('SELECT id FROM regions');

      expect(result.rows).toHaveLength(5);
      expect(result.truncated).toBe(false);
    });

    it('returns an empty result with its columns', async () => {
      const result = await executorWith().execute('SELECT id FROM regions WHERE false');

      expect(result.columns).toEqual([{ name: 'id', type: 'int8' }]);
      expect(result.rows).toEqual([]);
      expect(result.truncated).toBe(false);
    });
  });

  describe('timeouts', () => {
    it('is cancelled by the database statement timeout', async () => {
      const executor = executorWith({
        statementTimeoutMs: SHORT_TIMEOUT_MS,
        appTimeoutMs: LONG_TIMEOUT_MS,
      });
      const startedAt = Date.now();

      await expect(executor.execute('SELECT pg_sleep(30)')).rejects.toMatchObject({
        code: 'QUERY_TIMEOUT',
      });

      expect(Date.now() - startedAt).toBeLessThan(SHORT_TIMEOUT_MS + TIMEOUT_TOLERANCE_MS);
    });

    it('is cancelled by the application timeout when the database one does not fire', async () => {
      const executor = executorWith({
        statementTimeoutMs: LONG_TIMEOUT_MS,
        appTimeoutMs: SHORT_TIMEOUT_MS,
      });
      const startedAt = Date.now();

      await expect(executor.execute('SELECT pg_sleep(30)')).rejects.toMatchObject({
        code: 'QUERY_TIMEOUT',
      });

      expect(Date.now() - startedAt).toBeLessThan(SHORT_TIMEOUT_MS + TIMEOUT_TOLERANCE_MS);
      await expect.poll(runningSleepQueries, { timeout: 5000 }).toBe(0);
    });

    it('keeps working after a timeout', async () => {
      const executor = executorWith({
        statementTimeoutMs: LONG_TIMEOUT_MS,
        appTimeoutMs: SHORT_TIMEOUT_MS,
      });
      await expect(executor.execute('SELECT pg_sleep(30)')).rejects.toMatchObject({
        code: 'QUERY_TIMEOUT',
      });

      const result = await executor.execute('SELECT 1 AS one');

      expect(result.rows).toEqual([[1]]);
    });

    it('re-applies the timeout even if a previous query tried to remove it', async () => {
      const executor = executorWith({
        statementTimeoutMs: SHORT_TIMEOUT_MS,
        appTimeoutMs: LONG_TIMEOUT_MS,
      });
      await executor.execute("SELECT set_config('statement_timeout', '0', false)");

      await expect(executor.execute('SELECT pg_sleep(30)')).rejects.toMatchObject({
        code: 'QUERY_TIMEOUT',
      });
    });
  });

  describe('errors', () => {
    it('reports a syntax error with the PostgreSQL message', async () => {
      await expect(executorWith().execute('SELEC 1')).rejects.toMatchObject({
        code: 'QUERY_SYNTAX_ERROR',
        details: [{ field: 'sql', message: expect.stringContaining('syntax error') as string }],
      });
    });

    it('reports an unknown table', async () => {
      await expect(executorWith().execute('SELECT * FROM invoices')).rejects.toMatchObject({
        code: 'QUERY_INVALID_REFERENCE',
        details: [{ field: 'sql', message: 'relation "invoices" does not exist' }],
      });
    });

    it('reports an unknown column', async () => {
      await expect(executorWith().execute('SELECT totl FROM orders')).rejects.toMatchObject({
        code: 'QUERY_INVALID_REFERENCE',
      });
    });

    it('denies a table outside the exposed schema without echoing details', async () => {
      const failure = executorWith().execute('SELECT token FROM app.secrets');

      await expect(failure).rejects.toMatchObject({ code: 'QUERY_NOT_ALLOWED' });
      await expect(failure).rejects.toHaveProperty('details', undefined);
    });

    it('does not echo row values on a data error', async () => {
      const failure = executorWith().execute('SELECT name::int FROM regions');

      await expect(failure).rejects.toMatchObject({
        code: 'QUERY_DATA_ERROR',
        message: 'A consulta falhou ao processar os dados.',
      });
      await expect(failure).rejects.toHaveProperty('details', undefined);
    });

    it.each([
      ['INSERT', "INSERT INTO regions (name) VALUES ('Leste')"],
      ['UPDATE', "UPDATE regions SET name = 'Leste'"],
      ['DELETE', 'DELETE FROM order_items'],
      ['DROP TABLE', 'DROP TABLE order_items'],
      ['SET', 'SET statement_timeout = 0'],
    ])('rejects %s, which is not a query', async (_statement, sql) => {
      await expect(executorWith().execute(sql)).rejects.toMatchObject({
        code: 'QUERY_SYNTAX_ERROR',
      });
    });

    it('rejects more than one statement', async () => {
      const executor = executorWith();

      await expect(
        executor.execute("SELECT 1; INSERT INTO regions (name) VALUES ('Leste')"),
      ).rejects.toMatchObject({ code: 'QUERY_SYNTAX_ERROR' });

      const regions = await executor.execute('SELECT count(*) FROM regions');
      expect(regions.rows).toEqual([['5']]);
    });

    it('keeps working after an error', async () => {
      const executor = executorWith();
      await expect(executor.execute('SELEC 1')).rejects.toMatchObject({
        code: 'QUERY_SYNTAX_ERROR',
      });

      const result = await executor.execute('SELECT 1 AS one');

      expect(result.rows).toEqual([[1]]);
    });

    it('reports an unreachable database without leaking connection details', async () => {
      const env = database.appEnv();
      const pool = createReadonlyPool({ ...env.database, readonlyPassword: 'wrong-password' });
      pools.push(pool);
      const failure = new QueryExecutor(pool, env.query).execute('SELECT 1');

      await expect(failure).rejects.toMatchObject({
        code: 'DATABASE_UNAVAILABLE',
        message: 'O banco de dados está indisponível no momento.',
      });
      await expect(failure).rejects.toHaveProperty('details', undefined);
    });
  });
});
