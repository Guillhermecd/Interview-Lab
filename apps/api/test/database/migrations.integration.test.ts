import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../../src/database/migrate.js';
import { seedDemoData } from '../../src/database/seed.js';
import {
  migrateTestDatabase,
  silentLog,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const INVALID_PASSWORD_CODE = '28P01';

describe('database migrations', () => {
  let database: TestDatabase;

  function schemaNames(): Promise<string[]> {
    return withClient(database.admin, async (client) => {
      const result = await client.query<{ nspname: string }>(
        "SELECT nspname FROM pg_namespace WHERE nspname IN ('sales', 'app') ORDER BY nspname",
      );
      return result.rows.map((row) => row.nspname);
    });
  }

  function roleNames(): Promise<string[]> {
    return withClient(database.admin, async (client) => {
      const result = await client.query<{ rolname: string }>(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('app_readonly', 'app_rw') ORDER BY rolname",
      );
      return result.rows.map((row) => row.rolname);
    });
  }

  beforeAll(async () => {
    database = await startTestDatabase();
  });

  afterAll(async () => {
    await database.stop();
  });

  it('runs on PostgreSQL 17', async () => {
    const result = await withClient(database.admin, (client) =>
      client.query<{ version: string }>("SELECT current_setting('server_version_num') AS version"),
    );

    expect(result.rows[0]?.version).toMatch(/^17\d{4}$/);
  });

  it('creates the schemas and roles', async () => {
    await migrateUp({ connection: database.admin, log: silentLog });

    expect(await schemaNames()).toEqual(['app', 'sales']);
    expect(await roleNames()).toEqual(['app_readonly', 'app_rw']);
  });

  it('does not let a role authenticate before a password is provisioned', async () => {
    const client = new Client({ ...database.readonly });

    await expect(client.connect()).rejects.toMatchObject({ code: INVALID_PASSWORD_CODE });
  });

  it('is a no-op when everything is already applied', async () => {
    await expect(
      migrateUp({ connection: database.admin, log: silentLog }),
    ).resolves.toBeUndefined();
  });

  it('rolls everything back and can be applied again', async () => {
    await migrateDown({ connection: database.admin, log: silentLog });

    expect(await schemaNames()).toEqual([]);
    expect(await roleNames()).toEqual([]);

    await migrateTestDatabase(database);

    expect(await schemaNames()).toEqual(['app', 'sales']);
    expect(await roleNames()).toEqual(['app_readonly', 'app_rw']);
  });
});

describe('demonstration seed', () => {
  let database: TestDatabase;

  function count(sql: string): Promise<number> {
    return withClient(database.readonly, async (client) => {
      const result = await client.query<{ total: string }>(sql);
      return Number(result.rows[0]?.total);
    });
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    await migrateTestDatabase(database);
    await withClient(database.admin, seedDemoData);
  });

  afterAll(async () => {
    await database.stop();
  });

  it('loads the expected volume', async () => {
    expect(await count('SELECT count(*) AS total FROM sales.regions')).toBe(5);
    expect(await count('SELECT count(*) AS total FROM sales.products')).toBe(40);
    expect(await count('SELECT count(*) AS total FROM sales.customers')).toBe(500);
    expect(await count('SELECT count(*) AS total FROM sales.orders')).toBe(20_000);
    expect(await count('SELECT count(*) AS total FROM sales.order_items')).toBeGreaterThan(20_000);
  });

  it('gives every order at least one item', async () => {
    const ordersWithoutItems = await count(
      `SELECT count(*) AS total
       FROM sales.orders AS orders
       WHERE NOT EXISTS (SELECT FROM sales.order_items AS items WHERE items.order_id = orders.id)`,
    );

    expect(ordersWithoutItems).toBe(0);
  });

  it('has revenue for every region in the last quarter', async () => {
    const regionsWithRevenue = await count(
      `SELECT count(DISTINCT customers.region_id) AS total
       FROM sales.orders AS orders
       JOIN sales.customers AS customers ON customers.id = orders.customer_id
       WHERE orders.ordered_at >= now() - interval '3 months'`,
    );

    expect(regionsWithRevenue).toBe(5);
  });

  it('spreads orders across at least 24 distinct months', async () => {
    const months = await count(
      "SELECT count(DISTINCT date_trunc('month', ordered_at)) AS total FROM sales.orders",
    );

    expect(months).toBeGreaterThanOrEqual(24);
  });

  it('keeps the same volume when run twice', async () => {
    await withClient(database.admin, seedDemoData);

    expect(await count('SELECT count(*) AS total FROM sales.orders')).toBe(20_000);
    expect(await count('SELECT count(*) AS total FROM sales.regions')).toBe(5);
  });
});
