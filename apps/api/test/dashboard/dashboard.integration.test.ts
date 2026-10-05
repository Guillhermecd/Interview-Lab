import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  DashboardFilterOptions,
  DashboardOverview,
  StockAlertList,
  StockMovementList,
} from '@interview-lab/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { seedDemoData } from '../../src/database/seed.js';
import { registerUser, sendCookieOnEveryRequest } from '../support/session.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

// A small, hand-made dataset, so every number below can be checked by hand.
// Times carry the -03 offset of the business; the period under test is
// 2026-03-11 to 2026-03-20, compared with 2026-03-01 to 2026-03-10.
//
// Products (price / cost):  1 Cimento (10 / 6)   2 Cabo (100 / 50)
//                           3 Luva (5 / 2)       4 Antigo (1 / 1, archived)
// Centers:                  1 CD A (Sudeste)     2 CD B (Sul)
const FIXTURE_SQL = `
  INSERT INTO sales.regions (name) VALUES ('Sudeste'), ('Sul');
  INSERT INTO sales.distribution_centers (name, city, state, region_id)
  VALUES ('CD A', 'Campinas', 'SP', 1), ('CD B', 'Curitiba', 'PR', 2);
  INSERT INTO sales.products (name, category, price, sku, unit, cost, active) VALUES
    ('Cimento', 'Cimento', 10, 'T-1', 'sc', 6, true),
    ('Cabo', 'Elétrica', 100, 'T-2', 'rl', 50, true),
    ('Luva', 'Aço', 5, 'T-3', 'pr', 2, true),
    ('Antigo', 'Aço', 1, 'T-4', 'un', 1, false);
  INSERT INTO sales.customers (name, region_id, created_at) VALUES ('Cliente', 1, '2026-01-01');

  INSERT INTO sales.orders
    (customer_id, status, ordered_at, distribution_center_id, expected_delivery_at, delivered_at)
  VALUES
    -- 1: in the period, delivered on time.
    (1, 'delivered', '2026-03-12 10:00-03', 1, '2026-03-15 12:00-03', '2026-03-14 12:00-03'),
    -- 2: late in the evening of the 18th (already the 19th in UTC); delivered after the period.
    (1, 'delivered', '2026-03-18 23:30-03', 2, '2026-03-21 12:00-03', '2026-03-22 12:00-03'),
    -- 3: cancelled, never counted.
    (1, 'cancelled', '2026-03-15 10:00-03', 1, '2026-03-18 12:00-03', NULL),
    -- 4: previous period; delivered late, inside the period.
    (1, 'delivered', '2026-03-05 10:00-03', 1, '2026-03-10 12:00-03', '2026-03-12 12:00-03'),
    -- 5: last minute of the previous period; delivered on time, inside the period.
    (1, 'delivered', '2026-03-10 23:59-03', 2, '2026-03-13 12:00-03', '2026-03-11 01:00-03'),
    -- 6: before both periods; only the ABC curve (12 months) sees it.
    (1, 'delivered', '2026-02-20 10:00-03', 1, '2026-02-26 12:00-03', '2026-02-25 12:00-03');

  INSERT INTO sales.order_items (order_id, product_id, quantity, unit_price) VALUES
    (1, 1, 10, 10), (1, 2, 2, 100),
    (2, 2, 1, 100),
    (3, 2, 50, 100),
    (4, 1, 20, 10),
    (5, 3, 10, 5),
    (6, 1, 100, 10);

  INSERT INTO sales.stock_movements
    (moved_at, type, product_id, distribution_center_id, destination_center_id, quantity,
     responsible_name, document)
  VALUES
    ('2026-01-01 08:00-03', 'inbound', 1, 1, NULL, 1000, 'Rafael', 'NF-e 1'),
    ('2026-01-01 08:00-03', 'inbound', 2, 1, NULL, 100, 'Rafael', 'NF-e 2'),
    ('2026-01-01 08:00-03', 'inbound', 2, 2, NULL, 50, 'Rafael', 'NF-e 3'),
    ('2026-01-01 08:00-03', 'inbound', 3, 2, NULL, 200, 'Rafael', 'NF-e 4'),
    ('2026-01-01 08:00-03', 'inbound', 4, 1, NULL, 10, 'Rafael', 'NF-e 5'),
    ('2026-02-21 10:00-03', 'outbound', 1, 1, NULL, 100, 'Juliana', 'Pedido 6'),
    ('2026-03-06 10:00-03', 'outbound', 1, 1, NULL, 20, 'Juliana', 'Pedido 4'),
    ('2026-03-11 00:30-03', 'outbound', 3, 2, NULL, 10, 'Juliana', 'Pedido 5'),
    ('2026-03-13 10:00-03', 'outbound', 1, 1, NULL, 10, 'Juliana', 'Pedido 1'),
    ('2026-03-13 10:00-03', 'outbound', 2, 1, NULL, 2, 'Juliana', 'Pedido 1'),
    ('2026-03-16 09:00-03', 'transfer', 2, 1, 2, 20, 'Patrícia', 'TRF 1'),
    ('2026-03-19 10:00-03', 'outbound', 2, 2, NULL, 1, 'Juliana', 'Pedido 2'),
    -- After the period: must not change what the dashboard shows for it.
    ('2026-03-25 10:00-03', 'adjustment', 1, 1, NULL, -70, 'Marcos', 'Avaria'),
    ('2026-03-28 10:00-03', 'inbound', 2, 1, NULL, 30, 'Rafael', 'NF-e 6'),
    -- Recent, relative to today: gives the alerts of "now" a critical item.
    (now() - interval '40 days', 'inbound', 3, 1, NULL, 100, 'Rafael', 'NF-e 7'),
    (now() - interval '2 days', 'outbound', 3, 1, NULL, 90, 'Juliana', 'Pedido 99');

  -- Balances of today: the sum of the movements above.
  INSERT INTO sales.stock_levels (distribution_center_id, product_id, quantity, minimum_quantity)
  VALUES
    (1, 1, 800, 900),  -- below the minimum
    (1, 2, 108, 50),
    (1, 3, 10, 50),    -- below the minimum, and running out
    (1, 4, 10, 100),   -- below the minimum, but archived: never an alert
    (2, 2, 69, 80),    -- below the minimum
    (2, 3, 190, 170);  -- above the minimum, close to it
`;

const PERIOD = 'period=custom&from=2026-03-11&to=2026-03-20';

describe('dashboard endpoints', () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;

  async function get<Body>(path: string): Promise<Body> {
    const response = await app.inject({ method: 'GET', url: `/api/dashboard/${path}` });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Body>();
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    await migrateTestDatabase(database);
    await withClient(database.admin, (client) => client.query(FIXTURE_SQL));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(database.appEnv())],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sendCookieOnEveryRequest(app, await registerUser(app, 'dashboard@example.com'));
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  it('requires a session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/overview',
      headers: { cookie: '' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('lists what the filters can be set to', async () => {
    expect(await get<DashboardFilterOptions>('filters')).toEqual({
      distributionCenters: [
        { id: '1', name: 'CD A', regionId: '1' },
        { id: '2', name: 'CD B', regionId: '2' },
      ],
      regions: [
        { id: '1', name: 'Sudeste' },
        { id: '2', name: 'Sul' },
      ],
      categories: ['Aço', 'Cimento', 'Elétrica'],
    });
  });

  describe('overview of a period', () => {
    let overview: DashboardOverview;

    beforeAll(async () => {
      overview = await get<DashboardOverview>(`overview?${PERIOD}`);
    });

    it('resolves the period and the one it is compared with', () => {
      expect(overview.period).toBe('custom');
      expect(overview.range).toEqual({ from: '2026-03-11', to: '2026-03-20' });
      expect(overview.previousRange).toEqual({ from: '2026-03-01', to: '2026-03-10' });
      expect(overview.categories).toEqual(['Aço', 'Cimento', 'Elétrica']);
    });

    it('sums the revenue without cancelled orders, by the day of the business', () => {
      // Orders 1 (300) and 2 (100) against orders 4 (200) and 5 (50).
      expect(overview.kpis.revenue).toEqual({
        value: 400,
        previousValue: 250,
        delta: 60,
        trend: 'up',
        sentiment: 'good',
        // Order 2 was placed on the 18th in São Paulo: sixth part, not the last.
        spark: [0, 300, 0, 0, 0, 100, 0],
      });
    });

    it('counts the orders and their average ticket', () => {
      expect(overview.kpis.orders).toMatchObject({
        value: 2,
        previousValue: 2,
        delta: 0,
        trend: 'flat',
        sentiment: 'neutral',
        averageTicket: 200,
        averageTicketDeltaPercent: 60,
      });
    });

    it('rebuilds the stock of the end of the period from the movements', () => {
      // End of the 20th: 870 Cimento, 78 + 69 Cabo, 190 Luva, 10 Antigo
      //   870*6 + 147*50 + 190*2 + 10*1 = 12,960
      // End of the 10th: 880 Cimento, 100 + 50 Cabo, 200 Luva, 10 Antigo = 13,190
      expect(overview.kpis.stockValue).toMatchObject({
        value: 12_960,
        previousValue: 13_190,
        delta: -1.7,
        trend: 'down',
        sentiment: 'neutral',
        distributionCenters: 2,
        activeProducts: 3,
      });
      expect(overview.kpis.stockValue.spark.at(-1)).toBe(12_960);
      expect(overview.kpis.stockValue.spark).toHaveLength(7);
    });

    it('computes the days of coverage from the cost of what left', () => {
      // Period: 230 of cost in 10 days, 12,960 / 23 = 563 days.
      // Before: 120 in 10 days, 13,190 / 12 = 1,099 days.
      expect(overview.kpis.coverageDays).toMatchObject({
        value: 563,
        previousValue: 1099,
        delta: -536,
        trend: 'down',
        sentiment: 'good',
        turnsPerYear: 0.6,
        // Some parts of the period had no outflow at all.
        spark: [],
      });
    });

    it('counts the active products below their minimum at each end of the period', () => {
      // Cimento in CD A, Cabo in CD B and Luva in CD A, at both ends. The
      // archived product is below its minimum too, and is left out.
      expect(overview.kpis.belowMinimum).toMatchObject({
        value: 3,
        previousValue: 3,
        delta: 0,
        trend: 'flat',
        sentiment: 'neutral',
        critical: 0,
        attention: 3,
      });
    });

    it('measures the deliveries of the period that met their date', () => {
      // Delivered in the period: orders 1 and 5 on time, order 4 late.
      expect(overview.kpis.onTimeDelivery).toMatchObject({
        value: 66.7,
        previousValue: null,
        delta: null,
        trend: 'flat',
        sentiment: 'neutral',
        targetPercent: 95,
        onTimeOrders: 2,
        deliveredOrders: 3,
      });
    });

    it('lines up each day with the same day of the previous period', () => {
      expect(overview.revenueSeries).toHaveLength(10);
      expect(overview.revenueSeries[1]).toEqual({
        date: '2026-03-12',
        revenue: 300,
        cumulative: 300,
        previousDate: '2026-03-02',
        previousRevenue: 0,
        previousCumulative: 0,
      });
      expect(overview.revenueSeries.at(-1)).toEqual({
        date: '2026-03-20',
        revenue: 0,
        cumulative: 400,
        previousDate: '2026-03-10',
        previousRevenue: 50,
        previousCumulative: 250,
      });
    });

    it('splits the revenue by the region of the distribution center', () => {
      expect(overview.revenueByRegion).toEqual([
        {
          regionId: '1',
          name: 'Sudeste',
          revenue: 300,
          previousRevenue: 200,
          deltaPercent: 50,
          trend: 'up',
          sentiment: 'good',
        },
        {
          regionId: '2',
          name: 'Sul',
          revenue: 100,
          previousRevenue: 50,
          deltaPercent: 100,
          trend: 'up',
          sentiment: 'good',
        },
      ]);
    });

    it('ranks the products of the period', () => {
      expect(overview.topProducts).toEqual({
        items: [
          { productId: '2', name: 'Cabo', category: 'Elétrica', revenue: 300 },
          { productId: '1', name: 'Cimento', category: 'Cimento', revenue: 100 },
        ],
        sharePercent: 100,
      });
    });

    it('shows the stock of each center by category, at the end of the period', () => {
      expect(overview.stockByCenter).toEqual([
        // Aço 10 (Antigo), Cimento 870*6, Elétrica 78*50.
        { distributionCenterId: '1', name: 'CD A', total: 9130, byCategory: [10, 5220, 3900] },
        // Aço 190*2 (Luva), Elétrica 69*50.
        { distributionCenterId: '2', name: 'CD B', total: 3830, byCategory: [380, 0, 3450] },
      ]);
    });

    it('builds the ABC curve from the last 12 months of the active products', () => {
      // Cimento 1,300, Cabo 300, Luva 50: shares before each are 0%, 78.8%, 97%.
      expect(overview.abc).toEqual({
        activeProducts: 3,
        classes: [
          { class: 'A', products: 2, revenueSharePercent: 97 },
          { class: 'B', products: 0, revenueSharePercent: 0 },
          { class: 'C', products: 1, revenueSharePercent: 3 },
        ],
        points: [
          { productsPercent: 0, revenuePercent: 0 },
          { productsPercent: 33.3, revenuePercent: 78.8 },
          { productsPercent: 66.7, revenuePercent: 97 },
          { productsPercent: 100, revenuePercent: 100 },
        ],
        classAEndPercent: 66.7,
        classBEndPercent: 66.7,
      });
    });
  });

  describe('filters', () => {
    it('narrows everything to one distribution center', async () => {
      const overview = await get<DashboardOverview>(`overview?${PERIOD}&distributionCenterId=2`);

      expect(overview.kpis.revenue).toMatchObject({ value: 100, previousValue: 50, delta: 100 });
      expect(overview.kpis.stockValue.value).toBe(3830);
      expect(overview.revenueByRegion.map((region) => region.name)).toEqual(['Sul']);
      expect(overview.stockByCenter.map((center) => center.name)).toEqual(['CD B']);
    });

    it('narrows to a region', async () => {
      const overview = await get<DashboardOverview>(`overview?${PERIOD}&regionId=1`);

      expect(overview.kpis.revenue.value).toBe(300);
      expect(overview.kpis.stockValue.value).toBe(9130);
    });

    it('narrows to a category, keeping every region in the chart', async () => {
      const overview = await get<DashboardOverview>(
        `overview?${PERIOD}&category=${encodeURIComponent('Elétrica')}`,
      );

      // Cabo only: 200 of order 1 and 100 of order 2; nothing before.
      expect(overview.kpis.revenue).toMatchObject({
        value: 300,
        previousValue: 0,
        delta: null,
        trend: 'flat',
      });
      expect(overview.kpis.orders.value).toBe(2);
      expect(overview.kpis.stockValue.value).toBe(147 * 50);
      expect(overview.revenueByRegion.map((region) => [region.name, region.revenue])).toEqual([
        ['Sudeste', 200],
        ['Sul', 100],
      ]);
      expect(overview.abc.activeProducts).toBe(1);
    });

    it('treats a filter value as data, never as SQL', async () => {
      const overview = await get<DashboardOverview>(
        `overview?${PERIOD}&category=${encodeURIComponent("' OR 1=1 --")}`,
      );

      expect(overview.kpis.revenue.value).toBe(0);
      expect(overview.topProducts.items).toEqual([]);
    });
  });

  describe('validation', () => {
    it.each([
      ['an unknown period', 'overview?period=decade', 'period'],
      ['a custom period without dates', 'overview?period=custom', 'from'],
      [
        'a range that ends before it starts',
        'overview?period=custom&from=2026-03-20&to=2026-03-11',
        'from',
      ],
      ['a range in the future', 'overview?period=custom&from=2026-03-11&to=2999-01-01', 'to'],
      [
        'an invalid identifier',
        `overview?${PERIOD}&distributionCenterId=1%20OR%201=1`,
        'distributionCenterId',
      ],
      ['an unknown alert status', 'stock-alerts?status=urgent', 'status'],
      ['an unknown movement type', 'stock-movements?type=theft', 'type'],
      ['a limit out of range', 'stock-movements?limit=1000', 'limit'],
    ])('refuses %s', async (_case, path, field) => {
      const response = await app.inject({ method: 'GET', url: `/api/dashboard/${path}` });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field }],
      });
    });
  });

  it('resolves the presets from the current day of the business', async () => {
    const overview = await get<DashboardOverview>('overview?period=7d');

    expect(overview.period).toBe('7d');
    expect(overview.revenueSeries).toHaveLength(7);
    expect(overview.range.to >= overview.range.from).toBe(true);
    expect(overview.previousRange.to < overview.range.from).toBe(true);
  });

  describe('stock alerts, as of now', () => {
    it('lists what is below or near the minimum, most urgent first', async () => {
      const alerts = await get<StockAlertList>('stock-alerts');

      expect(alerts.counts).toEqual({ all: 4, critical: 1, attention: 2, ok: 1 });
      expect(
        alerts.items.map((item) => [
          item.status,
          item.product,
          item.distributionCenter,
          item.quantity,
          item.minimumQuantity,
          item.coverageDays,
        ]),
      ).toEqual([
        // 90 left CD A in the last 30 days: 3 a day, 10 left, 3 days of coverage.
        ['critical', 'Luva', 'CD A', 10, 50, 3],
        // Below the minimum, with no recent outflow to measure coverage.
        ['attention', 'Cabo', 'CD B', 69, 80, null],
        ['attention', 'Cimento', 'CD A', 800, 900, null],
        // 190 with a minimum of 170: above it, by less than 20%.
        ['ok', 'Luva', 'CD B', 190, 170, null],
      ]);
      expect(alerts.items[0]).toMatchObject({ productId: '3', unit: 'pr' });
    });

    it('filters by status without changing the counts', async () => {
      const alerts = await get<StockAlertList>('stock-alerts?status=attention&limit=1');

      expect(alerts.counts).toEqual({ all: 4, critical: 1, attention: 2, ok: 1 });
      expect(alerts.items.map((item) => item.product)).toEqual(['Cabo']);
    });

    it('follows the filters of the dashboard', async () => {
      const alerts = await get<StockAlertList>('stock-alerts?distributionCenterId=2');

      expect(alerts.counts).toEqual({ all: 2, critical: 0, attention: 1, ok: 1 });
    });
  });

  describe('stock movements', () => {
    it('lists the latest movements first', async () => {
      const movements = await get<StockMovementList>('stock-movements?limit=3');

      expect(movements.items.map((item) => [item.type, item.document, item.quantity])).toEqual([
        ['outbound', 'Pedido 99', 90],
        ['inbound', 'NF-e 7', 100],
        ['inbound', 'NF-e 6', 30],
      ]);
      expect(movements.items[2]).toMatchObject({
        movedAt: '2026-03-28T13:00:00.000Z',
        product: 'Cabo',
        unit: 'rl',
        distributionCenter: 'CD A',
        responsibleName: 'Rafael',
      });
      expect(movements.items[2]).not.toHaveProperty('destinationCenter');
    });

    it('filters by type, showing where a transfer went', async () => {
      const movements = await get<StockMovementList>('stock-movements?type=transfer');

      expect(movements.items).toHaveLength(1);
      expect(movements.items[0]).toMatchObject({
        type: 'transfer',
        distributionCenter: 'CD A',
        destinationCenter: 'CD B',
        quantity: 20,
      });
    });

    it('keeps the sign of an adjustment', async () => {
      const movements = await get<StockMovementList>('stock-movements?type=adjustment');

      expect(movements.items.map((item) => item.quantity)).toEqual([-70]);
    });

    it('shows a center the transfers it received as well as what it sent', async () => {
      const movements = await get<StockMovementList>(
        'stock-movements?distributionCenterId=2&type=transfer',
      );

      expect(movements.items).toHaveLength(1);
    });
  });

  // The statements must also be fast enough on the full demonstration data:
  // they run under the same 5 s statement timeout as every query.
  describe('with the demonstration seed', () => {
    beforeAll(async () => {
      await withClient(database.admin, seedDemoData);
    });

    it('answers the overview of each preset', async () => {
      for (const period of ['7d', '30d', 'month', 'quarter', 'year']) {
        const overview = await get<DashboardOverview>(`overview?period=${period}`);

        expect(overview.kpis.revenue.value).toBeGreaterThan(0);
        expect(overview.kpis.stockValue.value).toBeGreaterThan(0);
        expect(overview.stockByCenter).toHaveLength(9);
        expect(overview.revenueByRegion).toHaveLength(5);
        expect(overview.topProducts.items).toHaveLength(10);
        expect(overview.abc.activeProducts).toBe(200);
        expect(overview.categories).toHaveLength(5);
      }
    });

    it('has alerts and movements to show', async () => {
      const alerts = await get<StockAlertList>('stock-alerts');
      const movements = await get<StockMovementList>('stock-movements');

      expect(alerts.counts.critical).toBeGreaterThan(0);
      expect(alerts.counts.attention).toBeGreaterThan(0);
      expect(alerts.items).toHaveLength(8);
      expect(movements.items).toHaveLength(8);
    });
  });
});
