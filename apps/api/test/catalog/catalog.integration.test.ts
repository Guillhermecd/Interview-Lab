import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  AuthUser,
  CatalogOptions,
  CatalogProductDetail,
  CatalogProductPage,
  Conversation,
  ProductStockLevel,
  RecordedStockMovement,
  StockMovementPage,
} from '@interview-lab/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { promoteAdmin, UnknownAccountError } from '../../src/database/promote-admin.js';
import { LLM_PROVIDER } from '../../src/llm/llm-provider.js';
import { ScriptedLlmProvider, sqlAnswer } from '../support/scripted-llm-provider.js';
import { registerUser } from '../support/session.js';
import { parseSseBody } from '../support/sse-client.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';

// Two centers and two products, one of them archived. "Cimento" starts with
// 100 bags in CD A, recorded as a movement so the ledger adds up from the start.
const FIXTURE_SQL = `
  INSERT INTO sales.regions (name) VALUES ('Sudeste'), ('Sul');
  INSERT INTO sales.distribution_centers (name, city, state, region_id)
  VALUES ('CD A', 'Campinas', 'SP', 1), ('CD B', 'Curitiba', 'PR', 2);
  INSERT INTO sales.products (name, category, price, sku, unit, cost, active) VALUES
    ('Cimento 50 kg', 'Cimento', 38, 'CIM-50', 'sc', 25, true),
    ('Vergalhão antigo', 'Aço', 40, 'VER-OLD', 'br', 30, false);
  INSERT INTO sales.stock_movements
    (moved_at, type, product_id, distribution_center_id, quantity, responsible_name, document)
  VALUES (now() - interval '1 day', 'inbound', 1, 1, 100, 'Carga inicial', 'NF-e 1');
  INSERT INTO sales.stock_levels (distribution_center_id, product_id, quantity, minimum_quantity)
  VALUES (1, 1, 100, 20);
`;

// Every balance must be exactly the sum of its movements (the same check the
// seed has to pass).
const LEDGER_MISMATCHES_SQL = `
  SELECT count(*) AS total
  FROM sales.stock_levels AS levels
  LEFT JOIN (
    SELECT ledger.distribution_center_id, ledger.product_id, sum(ledger.quantity) AS quantity
    FROM (
      SELECT distribution_center_id, product_id,
             CASE WHEN type IN ('inbound', 'adjustment') THEN quantity ELSE -quantity END AS quantity
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
  WHERE coalesce(balance.quantity, 0) <> levels.quantity`;

const STOCK_TOTAL_SQL = 'SELECT sum(quantity) AS estoque FROM stock_levels';

const NEW_PRODUCT = {
  sku: 'cab-25',
  name: 'Cabo flexível 2,5 mm',
  category: 'Cimento',
  unit: 'rl',
  price: 265.5,
  cost: 180,
};

describe('registry of products and stock movements', () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let provider: ScriptedLlmProvider;
  // Id of the product created by the tests. Not a fixed number: the insert the
  // role test rolls back also spends an id.
  let createdId = '';
  let admin: string;
  let viewer: string;

  type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

  function call(method: Method, path: string, cookie: string, payload?: unknown) {
    return app.inject({
      method,
      url: `/api/catalog/${path}`,
      headers: { cookie },
      ...(payload !== undefined && { payload: payload as object }),
    });
  }

  async function get<Body>(path: string): Promise<Body> {
    const response = await call('GET', path, admin);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Body>();
  }

  function move(payload: Record<string, unknown>) {
    return call('POST', 'stock-movements', admin, payload);
  }

  async function quantityAt(productId: string, centerId: string): Promise<number> {
    const product = await get<CatalogProductDetail>(`products/${productId}`);
    return (
      product.stockLevels.find((level) => level.distributionCenterId === centerId)?.quantity ?? -1
    );
  }

  function count(sql: string): Promise<number> {
    return withClient(database.admin, async (client) => {
      const result = await client.query<{ total: string }>(sql);
      return Number(result.rows[0]?.total);
    });
  }

  beforeAll(async () => {
    database = await startTestDatabase({ redis: true });
    await migrateTestDatabase(database);
    await withClient(database.admin, (client) => client.query(FIXTURE_SQL));

    // Used by the cache test: one SQL generation, three explanations.
    provider = new ScriptedLlmProvider([sqlAnswer(STOCK_TOTAL_SQL)], ['Um.', 'Dois.', 'Três.']);
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register(
          database.appEnv({}, { limits: { sqlCacheTtlSeconds: 3600, resultCacheTtlSeconds: 300 } }),
        ),
      ],
    })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    admin = await registerUser(app, 'admin@example.com', 'Carla Souza');
    viewer = await registerUser(app, 'viewer@example.com', 'Visitante');
    await withClient(database.admin, (client) => promoteAdmin(client, 'Admin@Example.com '));
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  describe('who may use it', () => {
    it('tells the client what each user may do, without exposing roles', async () => {
      const me = (cookie: string) =>
        app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });

      expect((await me(admin)).json<AuthUser>()).toEqual({
        id: expect.any(String) as string,
        email: 'admin@example.com',
        name: 'Carla Souza',
        canManageCatalog: true,
      });
      expect((await me(viewer)).json<AuthUser>().canManageCatalog).toBe(false);
    });

    it('never makes a new account an administrator', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { name: 'Novo', email: 'novo@example.com', password: 'senha-de-teste-123' },
      });

      expect(response.json<AuthUser>().canManageCatalog).toBe(false);
    });

    it('promotes only accounts that exist', async () => {
      await expect(
        withClient(database.admin, (client) => promoteAdmin(client, 'ninguem@example.com')),
      ).rejects.toBeInstanceOf(UnknownAccountError);
    });

    it.each([
      ['GET', 'options'],
      ['GET', 'products'],
      ['GET', 'products/1'],
      ['POST', 'products'],
      ['PUT', 'products/1'],
      ['DELETE', 'products/1'],
      ['POST', 'products/1/restore'],
      ['PUT', 'products/1/stock-levels/1'],
      ['GET', 'stock-movements'],
      ['POST', 'stock-movements'],
    ] as const)('answers 401 without a session and 403 to a viewer: %s %s', async (method, path) => {
      expect((await call(method, path, '')).statusCode).toBe(401);

      const refused = await call(method, path, viewer, {});
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('left nothing changed after the refused requests', async () => {
      expect(await count('SELECT count(*) AS total FROM sales.products')).toBe(2);
      expect(await count('SELECT count(*) AS total FROM sales.products WHERE active')).toBe(1);
      expect(await count('SELECT count(*) AS total FROM sales.stock_movements')).toBe(1);
    });
  });

  describe('the database role behind it', () => {
    function asCatalogRole(sql: string): Promise<unknown> {
      return withClient(database.catalog, (client) => client.query(sql));
    }

    it.each([
      ['read orders', 'SELECT * FROM sales.orders'],
      ['read order items', 'SELECT * FROM sales.order_items'],
      ['read customers', 'SELECT * FROM sales.customers'],
      ['read regions', 'SELECT * FROM sales.regions'],
      ['read users', 'SELECT * FROM app.users'],
      ['read conversations', 'SELECT * FROM app.conversations'],
      ['delete a product', 'DELETE FROM sales.products WHERE id = 2'],
      ['delete a movement', 'DELETE FROM sales.stock_movements'],
      ['delete a balance', 'DELETE FROM sales.stock_levels'],
      ['rewrite a movement', 'UPDATE sales.stock_movements SET quantity = 1'],
      ['change a distribution center', "UPDATE sales.distribution_centers SET name = 'x'"],
      [
        'create a distribution center',
        "INSERT INTO sales.distribution_centers (name, city, state, region_id) VALUES ('x', 'x', 'SP', 1)",
      ],
      ['change an order', "UPDATE sales.orders SET status = 'cancelled'"],
      ['truncate products', 'TRUNCATE sales.products CASCADE'],
      ['drop a table', 'DROP TABLE sales.stock_levels'],
      ['create a table', 'CREATE TABLE sales.backdoor (id int)'],
      ['make itself an administrator', "UPDATE app.users SET role = 'admin'"],
    ])('cannot %s', async (_action, sql) => {
      await expect(asCatalogRole(sql)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('can do what the registry needs, and only in a rolled-back transaction here', async () => {
      await withClient(database.catalog, async (client) => {
        await client.query('BEGIN');
        await client.query(
          "INSERT INTO sales.products (sku, name, category, unit, price, cost) VALUES ('T', 'T', 'Aço', 'un', 1, 1)",
        );
        await client.query('UPDATE sales.products SET active = false WHERE id = 1');
        await client.query(
          `INSERT INTO sales.stock_levels (distribution_center_id, product_id, quantity, minimum_quantity)
           VALUES (2, 1, 5, 0)
           ON CONFLICT (distribution_center_id, product_id) DO UPDATE SET quantity = 5`,
        );
        await client.query(
          `INSERT INTO sales.stock_movements
             (moved_at, type, product_id, distribution_center_id, quantity, responsible_name, document)
           VALUES (now(), 'inbound', 1, 2, 5, 'x', 'x')`,
        );
        await client.query('ROLLBACK');
      });
    });
  });

  describe('products', () => {
    it('offers the existing categories, the units and the centers', async () => {
      expect(await get<CatalogOptions>('options')).toEqual({
        categories: ['Aço', 'Cimento'],
        units: ['sc', 'br', 'rl', 'pr', 'un'],
        distributionCenters: [
          { id: '1', name: 'CD A' },
          { id: '2', name: 'CD B' },
        ],
      });
    });

    it('lists the active products by default, with their total stock', async () => {
      const page = await get<CatalogProductPage>('products');

      expect(page).toEqual({
        items: [
          {
            id: '1',
            sku: 'CIM-50',
            name: 'Cimento 50 kg',
            category: 'Cimento',
            unit: 'sc',
            price: 38,
            cost: 25,
            active: true,
            totalQuantity: 100,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    });

    it('filters by status, category and text, and pages the list', async () => {
      const names = async (query: string) =>
        (await get<CatalogProductPage>(`products?${query}`)).items.map((item) => item.name);

      expect(await names('status=all')).toEqual(['Cimento 50 kg', 'Vergalhão antigo']);
      expect(await names('status=archived')).toEqual(['Vergalhão antigo']);
      expect(await names(`status=all&category=${encodeURIComponent('Aço')}`)).toEqual([
        'Vergalhão antigo',
      ]);
      expect(await names('status=all&search=ver-old')).toEqual(['Vergalhão antigo']);
      expect(await names('status=all&search=cimento')).toEqual(['Cimento 50 kg']);
      // Typed text is searched as it is: % matches nothing here.
      expect(await names('status=all&search=%25')).toEqual([]);

      const second = await get<CatalogProductPage>('products?status=all&pageSize=1&page=2');
      expect(second.items.map((item) => item.name)).toEqual(['Vergalhão antigo']);
      expect(second.total).toBe(2);
    });

    it('creates a product, normalising the SKU, with no stock yet', async () => {
      const response = await call('POST', 'products', admin, NEW_PRODUCT);

      expect(response.statusCode).toBe(201);
      createdId = response.json<CatalogProductDetail>().id;
      expect(response.json<CatalogProductDetail>()).toEqual({
        id: createdId,
        sku: 'CAB-25',
        name: 'Cabo flexível 2,5 mm',
        category: 'Cimento',
        unit: 'rl',
        price: 265.5,
        cost: 180,
        active: true,
        totalQuantity: 0,
        stockLevels: [
          {
            distributionCenterId: '1',
            distributionCenter: 'CD A',
            quantity: 0,
            minimumQuantity: 0,
          },
          {
            distributionCenterId: '2',
            distributionCenter: 'CD B',
            quantity: 0,
            minimumQuantity: 0,
          },
        ],
      });
    });

    it('refuses a SKU or a name already in use', async () => {
      const sameSku = await call('POST', 'products', admin, { ...NEW_PRODUCT, name: 'Outro nome' });
      const sameName = await call('POST', 'products', admin, { ...NEW_PRODUCT, sku: 'CAB-99' });

      expect(sameSku.statusCode).toBe(409);
      expect(sameSku.json()).toMatchObject({ code: 'SKU_IN_USE' });
      expect(sameName.statusCode).toBe(409);
      expect(sameName.json()).toMatchObject({ code: 'NAME_IN_USE' });
    });

    it.each([
      ['a category that does not exist', { category: 'Brinquedos' }, 'category'],
      ['a unit that does not exist', { unit: 'kg' }, 'unit'],
      ['a price of zero', { price: 0 }, 'price'],
      ['a price with three decimals', { price: 1.234 }, 'price'],
      ['a price sent as text', { price: '10' }, 'price'],
      ['a negative cost', { cost: -1 }, 'cost'],
      ['a SKU with spaces', { sku: 'A B' }, 'sku'],
      ['a name too short', { name: 'ab' }, 'name'],
    ])('refuses %s', async (_case, change, field) => {
      const response = await call('POST', 'products', admin, {
        ...NEW_PRODUCT,
        sku: 'NOVO-1',
        name: 'Material novo',
        ...change,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field }] });
    });

    it('replaces the data of a product', async () => {
      const response = await call('PUT', `products/${createdId}`, admin, {
        ...NEW_PRODUCT,
        name: 'Cabo flexível 2,5 mm 100 m',
        price: 270,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<CatalogProductDetail>()).toMatchObject({
        id: createdId,
        sku: 'CAB-25',
        name: 'Cabo flexível 2,5 mm 100 m',
        price: 270,
      });
    });

    it('refuses to rename a product to a SKU of another one', async () => {
      const response = await call('PUT', `products/${createdId}`, admin, {
        ...NEW_PRODUCT,
        sku: 'CIM-50',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'SKU_IN_USE' });
    });

    it('answers 404 for a product that does not exist, and 400 for a malformed id', async () => {
      expect((await call('GET', 'products/999', admin)).statusCode).toBe(404);
      expect((await call('PUT', 'products/999', admin, NEW_PRODUCT)).json()).toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
      expect((await call('DELETE', 'products/999', admin)).statusCode).toBe(404);
      expect((await call('GET', 'products/1;DROP', admin)).statusCode).toBe(400);
    });

    it('archives instead of deleting, and restores', async () => {
      const archived = await call('DELETE', `products/${createdId}`, admin);
      expect(archived.statusCode).toBe(200);
      expect(archived.json<CatalogProductDetail>().active).toBe(false);
      // Nothing was erased.
      expect(await count('SELECT count(*) AS total FROM sales.products')).toBe(3);

      const listed = await get<CatalogProductPage>('products');
      expect(listed.items.map((item) => item.sku)).toEqual(['CIM-50']);

      const restored = await call('POST', `products/${createdId}/restore`, admin);
      expect(restored.statusCode).toBe(200);
      expect(restored.json<CatalogProductDetail>().active).toBe(true);
    });

    it('sets the minimum stock of a center, even one that never held the product', async () => {
      const response = await call('PUT', `products/${createdId}/stock-levels/2`, admin, {
        minimumQuantity: 40,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<ProductStockLevel>()).toEqual({
        distributionCenterId: '2',
        distributionCenter: 'CD B',
        quantity: 0,
        minimumQuantity: 40,
      });
    });

    it('keeps the balance when only the minimum changes', async () => {
      await call('PUT', 'products/1/stock-levels/1', admin, { minimumQuantity: 30 });

      const product = await get<CatalogProductDetail>('products/1');
      expect(product.stockLevels[0]).toMatchObject({ quantity: 100, minimumQuantity: 30 });
    });

    it('refuses a minimum for an unknown product or center, or a negative one', async () => {
      const body = { minimumQuantity: 1 };

      expect((await call('PUT', 'products/999/stock-levels/1', admin, body)).json()).toMatchObject({
        code: 'PRODUCT_NOT_FOUND',
      });
      expect((await call('PUT', 'products/1/stock-levels/999', admin, body)).json()).toMatchObject({
        code: 'DISTRIBUTION_CENTER_NOT_FOUND',
      });
      expect(
        (await call('PUT', 'products/1/stock-levels/1', admin, { minimumQuantity: -1 })).statusCode,
      ).toBe(400);
    });
  });

  describe('stock movements', () => {
    const base = { productId: '1', distributionCenterId: '1', document: 'Doc 1' };

    it('adds what comes in, signed by the user of the session', async () => {
      const response = await move({
        ...base,
        type: 'inbound',
        quantity: 50,
        document: 'NF-e 2',
        // Sent by a tampered client: ignored.
        responsibleName: 'Outra pessoa',
        movedAt: '2020-01-01T00:00:00.000Z',
      });

      expect(response.statusCode).toBe(201);
      const recorded = response.json<RecordedStockMovement>();
      expect(recorded.movement).toMatchObject({
        type: 'inbound',
        product: 'Cimento 50 kg',
        unit: 'sc',
        distributionCenter: 'CD A',
        quantity: 50,
        responsibleName: 'Carla Souza',
        document: 'NF-e 2',
      });
      expect(Date.now() - Date.parse(recorded.movement.movedAt)).toBeLessThan(60_000);
      expect(recorded.stockLevels).toEqual([
        {
          distributionCenterId: '1',
          distributionCenter: 'CD A',
          quantity: 150,
          minimumQuantity: 30,
        },
      ]);
    });

    it('takes what leaves', async () => {
      const response = await move({ ...base, type: 'outbound', quantity: 30 });

      expect(response.statusCode).toBe(201);
      expect(await quantityAt('1', '1')).toBe(120);
    });

    it('refuses to take more than there is, changing nothing', async () => {
      const movementsBefore = await count('SELECT count(*) AS total FROM sales.stock_movements');

      const response = await move({ ...base, type: 'outbound', quantity: 121 });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      expect(await quantityAt('1', '1')).toBe(120);
      expect(await count('SELECT count(*) AS total FROM sales.stock_movements')).toBe(
        movementsBefore,
      );
    });

    it('moves stock between centers, creating the balance at the destination', async () => {
      const response = await move({
        ...base,
        type: 'transfer',
        destinationCenterId: '2',
        quantity: 20,
      });

      expect(response.statusCode).toBe(201);
      const recorded = response.json<RecordedStockMovement>();
      expect(recorded.movement).toMatchObject({
        distributionCenter: 'CD A',
        destinationCenter: 'CD B',
        quantity: 20,
      });
      expect(
        recorded.stockLevels.map((level) => [level.distributionCenter, level.quantity]),
      ).toEqual([
        ['CD A', 100],
        ['CD B', 20],
      ]);
    });

    it('rolls a transfer back entirely when the origin cannot cover it', async () => {
      const response = await move({
        ...base,
        distributionCenterId: '2',
        type: 'transfer',
        destinationCenterId: '1',
        quantity: 21,
      });

      expect(response.statusCode).toBe(409);
      expect(await quantityAt('1', '1')).toBe(100);
      expect(await quantityAt('1', '2')).toBe(20);
    });

    it('adjusts up or down, never below zero', async () => {
      expect((await move({ ...base, type: 'adjustment', quantity: -10 })).statusCode).toBe(201);
      expect(await quantityAt('1', '1')).toBe(90);

      expect((await move({ ...base, type: 'adjustment', quantity: 5 })).statusCode).toBe(201);
      expect(await quantityAt('1', '1')).toBe(95);

      const tooMuch = await move({ ...base, type: 'adjustment', quantity: -96 });
      expect(tooMuch.json()).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      expect(await quantityAt('1', '1')).toBe(95);
    });

    it.each([
      ['an unknown type', { type: 'theft', quantity: 1 }, 'type'],
      ['a quantity of zero', { type: 'inbound', quantity: 0 }, 'quantity'],
      ['a negative entry', { type: 'inbound', quantity: -5 }, 'quantity'],
      ['a fractional quantity', { type: 'inbound', quantity: 1.5 }, 'quantity'],
      ['a quantity above the cap', { type: 'inbound', quantity: 1_000_001 }, 'quantity'],
      ['a transfer without destination', { type: 'transfer', quantity: 1 }, 'destinationCenterId'],
      [
        'a transfer to the same center',
        { type: 'transfer', quantity: 1, destinationCenterId: '1' },
        'destinationCenterId',
      ],
      ['no document', { type: 'inbound', quantity: 1, document: '  ' }, 'document'],
      [
        'a malformed product id',
        { type: 'inbound', quantity: 1, productId: '1 OR 1=1' },
        'productId',
      ],
    ])('refuses %s', async (_case, change, field) => {
      const response = await move({ ...base, ...change });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field }] });
    });

    it('refuses unknown products and centers, and archived products', async () => {
      const inbound = { type: 'inbound', quantity: 1, document: 'x' };

      expect(
        (await move({ ...inbound, productId: '999', distributionCenterId: '1' })).json(),
      ).toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
      expect(
        (await move({ ...inbound, productId: '1', distributionCenterId: '999' })).json(),
      ).toMatchObject({ code: 'DISTRIBUTION_CENTER_NOT_FOUND' });
      const archived = await move({ ...inbound, productId: '2', distributionCenterId: '1' });
      expect(archived.statusCode).toBe(409);
      expect(archived.json()).toMatchObject({ code: 'PRODUCT_ARCHIVED' });
    });

    it('lets only one of two requests take the last units', async () => {
      // 95 in stock: two requests for 60 at the same time cannot both succeed.
      const responses = await Promise.all([
        move({ ...base, type: 'outbound', quantity: 60, document: 'Pedido A' }),
        move({ ...base, type: 'outbound', quantity: 60, document: 'Pedido B' }),
      ]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
      expect(await quantityAt('1', '1')).toBe(35);
    });

    it('does not deadlock on transfers in opposite directions', async () => {
      const responses = await Promise.all([
        move({ ...base, type: 'transfer', destinationCenterId: '2', quantity: 5 }),
        move({
          ...base,
          distributionCenterId: '2',
          type: 'transfer',
          destinationCenterId: '1',
          quantity: 5,
        }),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
      expect(await quantityAt('1', '1')).toBe(35);
      expect(await quantityAt('1', '2')).toBe(20);
    });

    it('lists the movements, latest first, by product and type', async () => {
      const all = await get<StockMovementPage>('stock-movements?productId=1&pageSize=3');
      expect(all.items).toHaveLength(3);
      expect(all.total).toBeGreaterThan(3);
      const times = all.items.map((item) => item.movedAt);
      expect(times).toEqual([...times].sort().reverse());

      const adjustments = await get<StockMovementPage>('stock-movements?type=adjustment');
      expect(adjustments.items.map((item) => item.quantity).sort()).toEqual([-10, 5]);
      expect((await get<StockMovementPage>(`stock-movements?productId=${createdId}`)).total).toBe(
        0,
      );
    });

    it('offers no way to change or remove a movement', async () => {
      expect((await call('DELETE', 'stock-movements/1', admin)).statusCode).toBe(404);
      expect((await call('PUT', 'stock-movements/1', admin, {})).statusCode).toBe(404);
    });

    it('left every balance equal to the sum of its movements', async () => {
      expect(await count(LEDGER_MISMATCHES_SQL)).toBe(0);
    });
  });

  describe('cached chat answers', () => {
    async function ask(question: string): Promise<unknown> {
      const conversation = (
        await app.inject({ method: 'POST', url: '/api/conversations', headers: { cookie: admin } })
      ).json<Conversation>();
      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: { cookie: admin },
        payload: { question },
      });
      const rows = parseSseBody(response.body).find((event) => event.event === 'rows');
      return (rows?.data as { result: { rows: unknown[][] } }).result.rows[0]?.[0];
    }

    it('are not served after the registry changes the data', async () => {
      const before = await ask('Qual o estoque total?');

      // The data changes behind the cache (not through the registry): the same
      // question still gets the cached result, which proves the cache is on.
      await withClient(database.admin, (client) =>
        client.query(
          'UPDATE sales.stock_levels SET quantity = quantity + 1000 WHERE product_id = $1',
          [createdId],
        ),
      );
      expect(await ask('Qual o estoque total?')).toBe(before);

      await move({
        productId: '1',
        distributionCenterId: '1',
        type: 'inbound',
        quantity: 7,
        document: 'NF-e 9',
      });

      // A write through the registry: the next answer reads the database again.
      expect(await ask('Qual o estoque total?')).toBe(String(Number(before) + 1000 + 7));
      // The SQL itself stayed cached: it was generated once.
      expect(provider.requests).toHaveLength(1);
    });
  });
});
