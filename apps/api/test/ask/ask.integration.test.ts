import { loadModule } from 'libpg-query';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NoAnswerCache } from '../../src/ask/answer-cache.js';
import { AskService } from '../../src/ask/ask.service.js';
import { seedDemoData } from '../../src/database/seed.js';
import { GuardedQueryService } from '../../src/query/guarded-query.service.js';
import { QueryExecutor } from '../../src/query/query-executor.service.js';
import { createReadonlyPool } from '../../src/query/readonly-pool.js';
import { SchemaCatalog } from '../../src/query/schema-catalog.service.js';
import { MAX_JOINS, SqlGuard } from '../../src/sql-guard/sql-guard.js';
import { ScriptedLlmProvider, sqlAnswer } from '../support/scripted-llm-provider.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const MAX_ROWS = 1000;
const EXPLAIN_MAX_ROWS = 50;

// The LLM is scripted; the schema introspection, the SQL guard, the executor
// and PostgreSQL are real.
describe('AskService against PostgreSQL', () => {
  let database: TestDatabase;
  let pool: Pool;
  let schemaCatalog: SchemaCatalog;
  let queries: GuardedQueryService;

  function serviceWith(provider: ScriptedLlmProvider): AskService {
    return new AskService(
      provider,
      schemaCatalog,
      queries,
      {
        maxRows: MAX_ROWS,
        explainMaxRows: EXPLAIN_MAX_ROWS,
      },
      new NoAnswerCache(),
    );
  }

  beforeAll(async () => {
    await loadModule();
    database = await startTestDatabase();
    await migrateTestDatabase(database);
    await withClient(database.admin, seedDemoData);

    const env = database.appEnv({ maxRows: MAX_ROWS });
    pool = createReadonlyPool(env.database);
    schemaCatalog = new SchemaCatalog(pool);
    queries = new GuardedQueryService(
      new SqlGuard({ maxRows: MAX_ROWS, maxJoins: MAX_JOINS }),
      new QueryExecutor(pool, env.query),
    );
  });

  afterAll(async () => {
    await pool.end();
    await database.stop();
  });

  describe('schema introspection', () => {
    it('describes exactly the exposed tables', async () => {
      const schema = await schemaCatalog.describe();

      expect(schema.tables.map((table) => table.name)).toEqual([
        'customers',
        'order_items',
        'orders',
        'products',
        'regions',
      ]);
    });

    it('describes columns, foreign keys and allowed values', async () => {
      const schema = await schemaCatalog.describe();
      const orders = schema.tables.find((table) => table.name === 'orders');

      expect(orders?.columns).toEqual([
        { name: 'id', type: 'bigint', nullable: false },
        { name: 'customer_id', type: 'bigint', nullable: false },
        { name: 'status', type: 'text', nullable: false },
        { name: 'ordered_at', type: 'timestamp with time zone', nullable: false },
      ]);
      expect(orders?.constraints).toContain('FOREIGN KEY (customer_id) REFERENCES customers(id)');
      expect(orders?.constraints.join('\n')).toContain("'cancelled'");
    });

    it('does not describe application tables', async () => {
      await withClient(database.admin, (client) =>
        client.query('CREATE TABLE IF NOT EXISTS app.users (id bigint PRIMARY KEY, email text)'),
      );
      const schema = await new SchemaCatalog(pool).describe();

      expect(JSON.stringify(schema)).not.toContain('email');
    });
  });

  it('answers a question end to end', async () => {
    const provider = new ScriptedLlmProvider(
      [
        sqlAnswer(
          `SELECT r.name AS regiao, count(*) AS pedidos
           FROM orders o JOIN customers c ON c.id = o.customer_id JOIN regions r ON r.id = c.region_id
           GROUP BY r.name ORDER BY r.name`,
          'bar',
          'regiao',
          'pedidos',
        ),
      ],
      ['Há pedidos nas cinco regiões.'],
    );

    const response = await serviceWith(provider).ask('Quantos pedidos por região?');

    expect(response).toMatchObject({
      status: 'answered',
      explanation: 'Há pedidos nas cinco regiões.',
      visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' },
      attempts: 1,
      usage: { calls: 2 },
    });
    expect(response.status === 'answered' && response.result.rows.map((row) => row[0])).toEqual([
      'Centro-Oeste',
      'Nordeste',
      'Norte',
      'Sudeste',
      'Sul',
    ]);
    expect(provider.requests[0]?.prompt).toContain('Table order_items');
  });

  it('recovers when the first SQL is refused by the guard', async () => {
    const provider = new ScriptedLlmProvider(
      [
        sqlAnswer('SELECT rolname FROM pg_roles'),
        sqlAnswer('SELECT count(*) AS regioes FROM regions'),
      ],
      ['Existem 5 regiões.'],
    );

    const response = await serviceWith(provider).ask('Quantas regiões existem?');

    expect(response).toMatchObject({ status: 'answered', attempts: 2 });
    expect(response.status === 'answered' && response.result.rows).toEqual([['5']]);
    expect(provider.requests[1]?.prompt).toContain('A tabela "pg_roles" não está disponível');
  });

  it('recovers when the first SQL fails in the database', async () => {
    const provider = new ScriptedLlmProvider(
      [sqlAnswer('SELECT total FROM orders'), sqlAnswer('SELECT count(*) AS total FROM orders')],
      ['São 20.000 pedidos.'],
    );

    const response = await serviceWith(provider).ask('Quantos pedidos?');

    expect(response).toMatchObject({ status: 'answered', attempts: 2 });
    expect(provider.requests[1]?.prompt).toContain('column "total" does not exist');
  });

  it('never executes a write, even if the LLM insists', async () => {
    const provider = new ScriptedLlmProvider([
      sqlAnswer("DELETE FROM regions WHERE name = 'Sul'"),
      sqlAnswer('WITH gone AS (DELETE FROM regions RETURNING *) SELECT * FROM gone'),
    ]);

    await expect(serviceWith(provider).ask('Apague a região Sul')).rejects.toMatchObject({
      code: 'QUERY_REJECTED',
    });

    const regions = await queries.run('SELECT count(*) FROM regions');
    expect(regions.rows).toEqual([['5']]);
  });

  it('sends the LLM at most the configured rows while the user receives all of them', async () => {
    const provider = new ScriptedLlmProvider(
      [sqlAnswer('SELECT id FROM orders ORDER BY id')],
      ['Lista parcial de pedidos.'],
    );

    const response = await serviceWith(provider).ask('Liste os pedidos');

    expect(response).toMatchObject({ status: 'answered' });
    expect(response.status === 'answered' && response.result.rowCount).toBe(MAX_ROWS);
    expect(provider.textRequests[0]?.prompt).toContain(`"rowsShown":${String(EXPLAIN_MAX_ROWS)}`);
    expect(provider.textRequests[0]?.prompt).toContain('"moreRowsExistInDatabase":true');
  });
});
