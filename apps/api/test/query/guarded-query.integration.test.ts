import { loadModule } from 'libpg-query';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoData } from '../../src/database/seed.js';
import { GuardedQueryService } from '../../src/query/guarded-query.service.js';
import { QueryExecutionError } from '../../src/query/query-error.js';
import { QueryExecutor } from '../../src/query/query-executor.service.js';
import { createReadonlyPool } from '../../src/query/readonly-pool.js';
import { EXPOSED_SCHEMA, EXPOSED_TABLES } from '../../src/sql-guard/allowlists.js';
import { MAX_JOINS, SqlGuard } from '../../src/sql-guard/sql-guard.js';
import { LEGITIMATE_QUERIES } from '../support/legitimate-queries.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const MAX_ROWS = 1000;
// The default of the application (QUERY_MAX_COST).
const MAX_COST = 170_000;
const TOTAL_ORDERS = 20_000;

describe('GuardedQueryService (SQL guard in front of the executor)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let queries: GuardedQueryService;

  beforeAll(async () => {
    await loadModule();
    database = await startTestDatabase();
    await migrateTestDatabase(database);
    await withClient(database.admin, seedDemoData);

    const env = database.appEnv({ maxRows: MAX_ROWS, maxCost: MAX_COST });
    pool = createReadonlyPool(env.database);
    queries = new GuardedQueryService(
      new SqlGuard({ maxRows: MAX_ROWS, maxJoins: MAX_JOINS }),
      new QueryExecutor(pool, env.query),
    );
  });

  afterAll(async () => {
    await pool.end();
    await database.stop();
  });

  it('exposes exactly the tables granted to app_readonly in the database', async () => {
    const granted = await withClient(database.admin, (client) =>
      client.query<{ table_schema: string; table_name: string }>(
        `SELECT table_schema, table_name FROM information_schema.role_table_grants
         WHERE grantee = 'app_readonly' AND privilege_type = 'SELECT'
         ORDER BY table_name`,
      ),
    );

    expect(granted.rows.map((row) => row.table_schema)).toEqual(
      granted.rows.map(() => EXPOSED_SCHEMA),
    );
    expect(granted.rows.map((row) => row.table_name)).toEqual([...EXPOSED_TABLES].sort());
  });

  describe('legitimate queries run as rewritten by the guard', () => {
    it.each(LEGITIMATE_QUERIES)('%s', async (_description, sql) => {
      const result = await queries.run(sql);

      expect(result.columns.length).toBeGreaterThan(0);
      expect(result.rowCount).toBeLessThanOrEqual(MAX_ROWS);
    });

    it('answers "revenue by region" with one row per region', async () => {
      const result = await queries.run(
        `SELECT r.name, sum(i.quantity * i.unit_price) AS revenue
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         JOIN regions r ON r.id = c.region_id
         JOIN order_items i ON i.order_id = o.id
         GROUP BY r.name ORDER BY r.name`,
      );

      expect(result.rows.map((row) => row[0])).toEqual([
        'Centro-Oeste',
        'Nordeste',
        'Norte',
        'Sudeste',
        'Sul',
      ]);
      expect(result.truncated).toBe(false);
    });
  });

  // D-65: the LIMIT caps the rows returned, not the work done to produce
  // them. The seed ends with ANALYZE, so the planner's estimates are real.
  describe('queries estimated as too expensive are refused without running', () => {
    async function refusalOf(action: Promise<unknown>): Promise<string> {
      const startedAt = performance.now();
      const error: unknown = await action.catch((caught: unknown) => caught);
      const elapsedMs = performance.now() - startedAt;

      expect(error).toBeInstanceOf(QueryExecutionError);
      const refused = error as QueryExecutionError;
      expect(refused.code).toBe('QUERY_REJECTED');
      // Planning takes milliseconds; running any of these would hit the 5 s
      // statement timeout.
      expect(elapsedMs).toBeLessThan(2000);
      return refused.details?.map((detail) => detail.message).join(' ') ?? '';
    }

    it('refuses a join that has a condition but multiplies the rows, by its cost', async () => {
      // Every item against every other item of the same product: about sixty
      // million pairs, properly joined.
      const reason = await refusalOf(
        queries.run(
          'SELECT count(*) FROM order_items a JOIN order_items b ON a.product_id = b.product_id',
        ),
      );

      expect(reason).toContain('custo estimado');
    });

    it('refuses an aggregate over orders × order_items', async () => {
      const reason = await refusalOf(
        queries.run('SELECT count(*) FROM orders CROSS JOIN order_items'),
      );

      // Too expensive and a cross join: the reason given is the one that tells
      // how to fix the query.
      expect(reason).toContain('produto cartesiano');
    });

    it('refuses the bare cross join, which the injected LIMIT makes look cheap', async () => {
      const reason = await refusalOf(queries.run('SELECT * FROM orders CROSS JOIN order_items'));

      expect(reason).toContain('produto cartesiano');
    });

    it('refuses the same join written with a comma', async () => {
      const reason = await refusalOf(queries.run('SELECT o.id, i.id FROM orders o, order_items i'));

      expect(reason).toContain('produto cartesiano');
    });

    it('refuses two generated series multiplied by each other', async () => {
      const reason = await refusalOf(
        queries.run(
          'SELECT count(*) FROM generate_series(1, 100000) a, generate_series(1, 100000) b',
        ),
      );

      expect(reason).toMatch(/custo estimado|produto cartesiano/);
    });

    it('refuses on check as well, so review mode never shows such SQL', async () => {
      const reason = await refusalOf(
        queries.check(
          'SELECT count(*) FROM order_items a JOIN order_items b ON a.product_id = b.product_id',
        ),
      );

      expect(reason).toContain('custo estimado');
    });

    it('leaves the connection usable after a refusal', async () => {
      await refusalOf(queries.run('SELECT * FROM orders CROSS JOIN order_items'));

      await expect(queries.run('SELECT count(*) FROM regions')).resolves.toMatchObject({
        rows: [['5']],
      });
    });

    it('accepts a small cross join: every region against every distribution center', async () => {
      const result = await queries.run(
        'SELECT r.name, d.name FROM regions r CROSS JOIN distribution_centers d',
      );

      expect(result.rowCount).toBe(45);
    });

    it('reports a cost for every legitimate query, all under the limit', async () => {
      const costs = await Promise.all(LEGITIMATE_QUERIES.map(([, sql]) => queries.check(sql)));

      expect(costs.every((cost) => cost > 0 && cost <= MAX_COST)).toBe(true);
    });
  });

  describe('LIMIT enforcement', () => {
    it('caps a query without LIMIT and still reports the truncation', async () => {
      const result = await queries.run('SELECT id FROM orders');

      expect(result.rowCount).toBe(MAX_ROWS);
      expect(result.truncated).toBe(true);
    });

    it('caps a LIMIT above the maximum and reports the truncation', async () => {
      const result = await queries.run('SELECT id FROM orders LIMIT 5000');

      expect(result.rowCount).toBe(MAX_ROWS);
      expect(result.truncated).toBe(true);
    });

    it('caps LIMIT ALL', async () => {
      const result = await queries.run('SELECT id FROM orders LIMIT ALL');

      expect(result.rowCount).toBe(MAX_ROWS);
      expect(result.truncated).toBe(true);
    });

    it('does not report truncation when the query asks for exactly the maximum', async () => {
      const result = await queries.run(`SELECT id FROM orders LIMIT ${String(MAX_ROWS)}`);

      expect(result.rowCount).toBe(MAX_ROWS);
      expect(result.truncated).toBe(false);
    });

    it('respects a smaller LIMIT written by the user', async () => {
      const result = await queries.run('SELECT id FROM orders LIMIT 7');

      expect(result.rowCount).toBe(7);
      expect(result.truncated).toBe(false);
    });

    it('keeps the ORDER BY of a query that had to be wrapped', async () => {
      const result = await queries.run('SELECT id FROM orders ORDER BY id DESC LIMIT 5000');
      const ids = result.rows.map((row) => Number(row[0]));

      expect(ids[0]).toBe(TOTAL_ORDERS);
      expect(ids).toEqual([...ids].sort((left, right) => right - left));
    });

    it('wraps a query whose columns share the same name', async () => {
      const result = await queries.run(
        'SELECT regions.id, customers.id FROM regions JOIN customers ON customers.region_id = regions.id LIMIT 5000',
      );

      expect(result.columns.map((column) => column.name)).toEqual(['id', 'id']);
      expect(result.rowCount).toBe(500);
    });

    it('caps a UNION as a whole', async () => {
      const result = await queries.run(
        'SELECT id FROM orders UNION ALL SELECT id FROM customers UNION ALL SELECT id FROM products',
      );

      expect(result.rowCount).toBe(MAX_ROWS);
      expect(result.truncated).toBe(true);
    });
  });

  describe('rejections never reach the database', () => {
    it.each<[string, string, string]>([
      ['a write', "INSERT INTO regions (name) VALUES ('Leste')", 'QUERY_REJECTED'],
      [
        'a write inside a CTE',
        'WITH d AS (DELETE FROM orders RETURNING id) SELECT * FROM d',
        'QUERY_REJECTED',
      ],
      ['two statements', 'SELECT 1; DROP TABLE regions', 'QUERY_REJECTED'],
      ['a system catalog', 'SELECT rolname FROM pg_roles', 'QUERY_REJECTED'],
      ['the app schema', 'SELECT * FROM app.users', 'QUERY_REJECTED'],
      ['a dangerous function', 'SELECT pg_sleep(30)', 'QUERY_REJECTED'],
      [
        'a session setting change',
        "SELECT set_config('statement_timeout', '0', false)",
        'QUERY_REJECTED',
      ],
      ['a syntax error', 'SELEC 1', 'QUERY_SYNTAX_ERROR'],
    ])('rejects %s', async (_description, sql, code) => {
      const startedAt = Date.now();

      await expect(queries.run(sql)).rejects.toMatchObject({
        code,
        details: [{ field: 'sql', message: expect.any(String) as string }],
      });

      // pg_sleep(30) would take far longer if it were executed.
      expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    it('leaves the data untouched', async () => {
      const result = await queries.run('SELECT count(*) FROM regions');

      expect(result.rows).toEqual([['5']]);
    });
  });
});
