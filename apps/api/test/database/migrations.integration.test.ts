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
        "SELECT rolname FROM pg_roles WHERE rolname IN ('app_readonly', 'app_rw', 'app_catalog_rw') ORDER BY rolname",
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
    expect(await roleNames()).toEqual(['app_catalog_rw', 'app_readonly', 'app_rw']);
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
    expect(await roleNames()).toEqual(['app_catalog_rw', 'app_readonly', 'app_rw']);
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
    expect(await count('SELECT count(*) AS total FROM sales.distribution_centers')).toBe(9);
    expect(await count('SELECT count(*) AS total FROM sales.products')).toBe(200);
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

  it('has revenue shipped by every distribution center in the last quarter', async () => {
    const centersWithRevenue = await count(
      `SELECT count(DISTINCT orders.distribution_center_id) AS total
       FROM sales.orders AS orders
       WHERE orders.ordered_at >= now() - interval '3 months' AND orders.status <> 'cancelled'`,
    );

    expect(centersWithRevenue).toBe(9);
  });

  it('keeps a stock balance for every product in every center', async () => {
    expect(await count('SELECT count(*) AS total FROM sales.stock_levels')).toBe(9 * 200);
  });

  // The registry (D-56) derives every balance from the movements: the seed
  // must start from a ledger that already adds up.
  it('has balances that are exactly the sum of their movements', async () => {
    const mismatches = await count(
      `SELECT count(*) AS total
       FROM sales.stock_levels AS levels
       LEFT JOIN (
         SELECT ledger.distribution_center_id, ledger.product_id, sum(ledger.quantity) AS quantity
         FROM (
           SELECT distribution_center_id, product_id,
                  CASE WHEN type IN ('inbound', 'adjustment') THEN quantity ELSE -quantity END
                    AS quantity
           FROM sales.stock_movements
           UNION ALL
           SELECT destination_center_id, product_id, quantity
           FROM sales.stock_movements
           WHERE type = 'transfer'
         ) AS ledger
         GROUP BY ledger.distribution_center_id, ledger.product_id
       ) AS balance
         ON balance.distribution_center_id = levels.distribution_center_id
        AND balance.product_id = levels.product_id
       WHERE balance.quantity IS DISTINCT FROM levels.quantity`,
    );

    expect(mismatches).toBe(0);
  });

  it('leaves some products below the minimum stock, and most above it', async () => {
    const below = await count(
      'SELECT count(*) AS total FROM sales.stock_levels WHERE quantity < minimum_quantity',
    );

    expect(below).toBeGreaterThan(10);
    expect(below).toBeLessThan(9 * 200 * 0.2);
  });

  it('has deliveries on time and late, and none before the order', async () => {
    const onTime = await count(
      `SELECT count(*) AS total FROM sales.orders
       WHERE delivered_at IS NOT NULL AND delivered_at <= expected_delivery_at`,
    );
    const late = await count(
      'SELECT count(*) AS total FROM sales.orders WHERE delivered_at > expected_delivery_at',
    );
    const inTheFuture = await count(
      'SELECT count(*) AS total FROM sales.orders WHERE delivered_at > now()',
    );

    expect(onTime).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
    expect(inTheFuture).toBe(0);
  });

  it('keeps the same volume when run twice', async () => {
    await withClient(database.admin, seedDemoData);

    expect(await count('SELECT count(*) AS total FROM sales.orders')).toBe(20_000);
    expect(await count('SELECT count(*) AS total FROM sales.regions')).toBe(5);
    expect(await count('SELECT count(*) AS total FROM sales.stock_levels')).toBe(9 * 200);
  });
});
