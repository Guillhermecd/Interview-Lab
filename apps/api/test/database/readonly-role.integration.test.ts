import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoData } from '../../src/database/seed.js';
import { expectPgError, PG_ERROR } from '../support/pg-errors.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const ROLE_STATEMENT_TIMEOUT_MS = 5000;
const TIMEOUT_TOLERANCE_MS = 3000;

describe('app_readonly role', () => {
  let database: TestDatabase;

  // Every test gets a fresh session, so a SET in one test never leaks into another.
  function asReadonly<T>(action: (client: Client) => Promise<T>): Promise<T> {
    return withClient(database.readonly, action);
  }

  // Lifts the role's read-only default, as a hostile session could. Whatever
  // still fails after this is blocked by privileges, not by a session setting.
  function asReadonlyWithWritesEnabled<T>(action: (client: Client) => Promise<T>): Promise<T> {
    return asReadonly(async (client) => {
      await client.query('SET default_transaction_read_only = off');
      return action(client);
    });
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    await migrateTestDatabase(database);
    await withClient(database.admin, async (client) => {
      await seedDemoData(client);
      await client.query('CREATE TABLE app.secrets (id bigint PRIMARY KEY, token text NOT NULL)');
      await client.query("INSERT INTO app.secrets VALUES (1, 'top-secret')");
    });
  });

  afterAll(async () => {
    await database.stop();
  });

  describe('reading', () => {
    it.each(['regions', 'products', 'customers', 'orders', 'order_items'])(
      'can SELECT from sales.%s',
      async (table) => {
        const result = await asReadonly((client) =>
          client.query<{ total: string }>(`SELECT count(*) AS total FROM sales.${table}`),
        );

        expect(Number(result.rows[0]?.total)).toBeGreaterThan(0);
      },
    );

    it('resolves unqualified table names to the sales schema', async () => {
      const result = await asReadonly((client) => client.query('SELECT id FROM regions'));

      expect(result.rowCount).toBe(5);
    });
  });

  describe('session defaults', () => {
    it('starts every session read-only with a 5s statement timeout', async () => {
      const settings = await asReadonly(async (client) => ({
        readOnly: await client.query<{ value: string }>(
          "SELECT current_setting('default_transaction_read_only') AS value",
        ),
        timeout: await client.query<{ value: string }>(
          "SELECT current_setting('statement_timeout') AS value",
        ),
      }));

      expect(settings.readOnly.rows[0]?.value).toBe('on');
      expect(settings.timeout.rows[0]?.value).toBe('5s');
    });

    it('rejects a write as a read-only transaction by default', async () => {
      await expectPgError(
        asReadonly((client) => client.query("INSERT INTO sales.regions (name) VALUES ('Leste')")),
        PG_ERROR.readOnlyTransaction,
      );
    });

    it('cancels a long query through statement_timeout', async () => {
      const startedAt = Date.now();

      await expectPgError(
        asReadonly((client) => client.query('SELECT pg_sleep(30)')),
        PG_ERROR.queryCanceled,
      );

      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(ROLE_STATEMENT_TIMEOUT_MS);
      expect(elapsedMs).toBeLessThan(ROLE_STATEMENT_TIMEOUT_MS + TIMEOUT_TOLERANCE_MS);
    });
  });

  describe('privileges, with the read-only default lifted by the session', () => {
    it.each([
      ['INSERT', "INSERT INTO sales.regions (name) VALUES ('Leste')"],
      ['UPDATE', "UPDATE sales.regions SET name = 'Leste'"],
      ['DELETE', 'DELETE FROM sales.order_items'],
      ['TRUNCATE', 'TRUNCATE sales.order_items'],
      ['DROP TABLE', 'DROP TABLE sales.order_items'],
      ['ALTER TABLE', 'ALTER TABLE sales.regions ADD COLUMN note text'],
      ['CREATE TABLE in sales', 'CREATE TABLE sales.intruder (id int)'],
      ['CREATE TABLE in public', 'CREATE TABLE public.intruder (id int)'],
      ['CREATE TEMP TABLE', 'CREATE TEMP TABLE intruder (id int)'],
      ['CREATE SCHEMA', 'CREATE SCHEMA intruder'],
      ['CREATE ROLE', 'CREATE ROLE intruder'],
    ])('denies %s', async (_statement, sql) => {
      await expectPgError(
        asReadonlyWithWritesEnabled((client) => client.query(sql)),
        PG_ERROR.insufficientPrivilege,
      );
    });

    it('leaves the data untouched after the denied statements', async () => {
      const result = await asReadonly((client) =>
        client.query<{ name: string }>('SELECT name FROM sales.regions ORDER BY name'),
      );

      expect(result.rows.map((row) => row.name)).toEqual([
        'Centro-Oeste',
        'Nordeste',
        'Norte',
        'Sudeste',
        'Sul',
      ]);
    });
  });

  describe('isolation from application data', () => {
    it('cannot read tables in the app schema', async () => {
      await expectPgError(
        asReadonly((client) => client.query('SELECT token FROM app.secrets')),
        PG_ERROR.insufficientPrivilege,
      );
    });

    it('cannot read the migration history', async () => {
      await expectPgError(
        asReadonly((client) => client.query('SELECT name FROM migrations.pgmigrations')),
        PG_ERROR.insufficientPrivilege,
      );
    });
  });
});

describe('app_rw role', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
    await migrateTestDatabase(database);
    await withClient(database.admin, (client) =>
      client.query(
        'CREATE TABLE app.notes (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, body text NOT NULL)',
      ),
    );
  });

  afterAll(async () => {
    await database.stop();
  });

  it('can write to and read from tables created in the app schema', async () => {
    const result = await withClient(database.app, async (client) => {
      await client.query("INSERT INTO app.notes (body) VALUES ('hello')");
      return client.query<{ body: string }>('SELECT body FROM app.notes');
    });

    expect(result.rows).toEqual([{ body: 'hello' }]);
  });

  it('cannot read the demonstration data', async () => {
    await expectPgError(
      withClient(database.app, (client) => client.query('SELECT id FROM sales.regions')),
      PG_ERROR.insufficientPrivilege,
    );
  });

  it('cannot change the structure of the app schema', async () => {
    await expectPgError(
      withClient(database.app, (client) => client.query('CREATE TABLE app.intruder (id int)')),
      PG_ERROR.insufficientPrivilege,
    );
  });
});
