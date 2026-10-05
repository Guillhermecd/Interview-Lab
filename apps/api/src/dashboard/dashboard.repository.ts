import { Inject, Injectable } from '@nestjs/common';
import type {
  DashboardFilterOptions,
  DashboardRange,
  StockAlert,
  StockAlertStatus,
  StockMovement,
  StockMovementType,
} from '@interview-lab/shared';
import { FixedReadQuery } from '../query/fixed-read-query.service.js';
import { DASHBOARD_TIME_ZONE } from './dashboard-period.js';
import {
  ABC_WINDOW_MONTHS,
  COVERAGE_WINDOW_DAYS,
  CRITICAL_COVERAGE_DAYS,
  NEAR_MINIMUM_FACTOR,
  TOP_PRODUCTS,
} from './dashboard-rules.js';

// What the user narrowed the dashboard to. Absent means "all".
export interface DashboardFilters {
  distributionCenterId?: string | undefined;
  regionId?: string | undefined;
  category?: string | undefined;
}

// Every statement below is fixed text. $1, $2 and $3 are always the filters;
// nothing typed by the user is ever concatenated into SQL.
const CENTER_FILTER =
  '($1::bigint IS NULL OR dc.id = $1) AND ($2::bigint IS NULL OR dc.region_id = $2)';
const CATEGORY_FILTER = '($3::text IS NULL OR p.category = $3)';

const TZ = `'${DASHBOARD_TIME_ZONE}'`;
// First and one-past-last instants of a calendar day of the business.
const dayStart = (parameter: string) => `(${parameter}::date::timestamp AT TIME ZONE ${TZ})`;
const dayEnd = (parameter: string) => `((${parameter}::date + 1)::timestamp AT TIME ZONE ${TZ})`;
const businessDate = (column: string) => `(${column} AT TIME ZONE ${TZ})::date`;

// The effect of every movement after `instant` on each center and product: a
// transfer takes from its origin and adds to its destination.
const ledgerAfter = (instant: string) => `
  SELECT m.distribution_center_id, m.product_id, m.moved_at,
         CASE WHEN m.type IN ('inbound', 'adjustment') THEN m.quantity ELSE -m.quantity END
           AS quantity
  FROM sales.stock_movements m
  WHERE m.moved_at > ${instant}
  UNION ALL
  SELECT m.destination_center_id, m.product_id, m.moved_at, m.quantity
  FROM sales.stock_movements m
  WHERE m.type = 'transfer' AND m.moved_at > ${instant}`;

const FILTER_OPTIONS_SQL = {
  centers: `SELECT dc.id, dc.name, dc.region_id FROM sales.distribution_centers dc ORDER BY dc.name`,
  regions: `SELECT r.id, r.name FROM sales.regions r ORDER BY r.name`,
  categories: `SELECT DISTINCT p.category FROM sales.products p ORDER BY p.category`,
};

// Revenue and orders per day. Cancelled orders are not sales.
const DAILY_SALES_SQL = `
  SELECT ${businessDate('o.ordered_at')} AS day,
         sum(i.quantity * i.unit_price) AS revenue,
         count(DISTINCT o.id) AS orders
  FROM sales.orders o
  JOIN sales.distribution_centers dc ON dc.id = o.distribution_center_id
  JOIN sales.order_items i ON i.order_id = o.id
  JOIN sales.products p ON p.id = i.product_id
  WHERE o.status <> 'cancelled'
    AND o.ordered_at >= ${dayStart('$4')} AND o.ordered_at < ${dayEnd('$5')}
    AND ${CENTER_FILTER} AND ${CATEGORY_FILTER}
  GROUP BY 1
  ORDER BY 1`;

// Cost of what left the stock, per day.
const DAILY_OUTFLOW_SQL = `
  SELECT ${businessDate('m.moved_at')} AS day, sum(m.quantity * p.cost) AS cost
  FROM sales.stock_movements m
  JOIN sales.distribution_centers dc ON dc.id = m.distribution_center_id
  JOIN sales.products p ON p.id = m.product_id
  WHERE m.type = 'outbound'
    AND m.moved_at >= ${dayStart('$4')} AND m.moved_at < ${dayEnd('$5')}
    AND ${CENTER_FILTER} AND ${CATEGORY_FILTER}
  GROUP BY 1
  ORDER BY 1`;

// Deliveries per day, and how many of them met the date promised.
const DAILY_DELIVERIES_SQL = `
  SELECT ${businessDate('o.delivered_at')} AS day,
         count(*) AS delivered,
         count(*) FILTER (WHERE o.delivered_at <= o.expected_delivery_at) AS on_time
  FROM sales.orders o
  JOIN sales.distribution_centers dc ON dc.id = o.distribution_center_id
  WHERE o.delivered_at >= ${dayStart('$4')} AND o.delivered_at < ${dayEnd('$5')}
    AND ${CENTER_FILTER}
    AND ($3::text IS NULL OR EXISTS (
      SELECT FROM sales.order_items i
      JOIN sales.products p ON p.id = i.product_id
      WHERE i.order_id = o.id AND p.category = $3
    ))
  GROUP BY 1
  ORDER BY 1`;

// Revenue of each region in the period ($5 to $6) and in the one before it
// ($4 to the day before $5). The region of a sale is that of its center (D-52).
const REGION_REVENUE_SQL = `
  SELECT r.id, r.name,
         coalesce(sum(i.quantity * i.unit_price) FILTER (WHERE o.ordered_at >= ${dayStart('$5')}), 0)
           AS revenue,
         coalesce(sum(i.quantity * i.unit_price) FILTER (WHERE o.ordered_at < ${dayStart('$5')}), 0)
           AS previous_revenue
  FROM sales.regions r
  JOIN sales.distribution_centers dc ON dc.region_id = r.id
  LEFT JOIN sales.orders o
    ON o.distribution_center_id = dc.id
   AND o.status <> 'cancelled'
   AND o.ordered_at >= ${dayStart('$4')} AND o.ordered_at < ${dayEnd('$6')}
  LEFT JOIN (sales.order_items i JOIN sales.products p ON p.id = i.product_id AND ${CATEGORY_FILTER})
    ON i.order_id = o.id
  WHERE ${CENTER_FILTER}
  GROUP BY r.id, r.name
  ORDER BY revenue DESC, r.name`;

const TOP_PRODUCTS_SQL = `
  WITH revenue AS (
    SELECT p.id, p.name, p.category, sum(i.quantity * i.unit_price) AS revenue
    FROM sales.orders o
    JOIN sales.distribution_centers dc ON dc.id = o.distribution_center_id
    JOIN sales.order_items i ON i.order_id = o.id
    JOIN sales.products p ON p.id = i.product_id
    WHERE o.status <> 'cancelled'
      AND o.ordered_at >= ${dayStart('$4')} AND o.ordered_at < ${dayEnd('$5')}
      AND ${CENTER_FILTER} AND ${CATEGORY_FILTER}
    GROUP BY p.id, p.name, p.category
  )
  SELECT id, name, category, revenue, sum(revenue) OVER () AS total
  FROM revenue
  ORDER BY revenue DESC, id
  LIMIT ${String(TOP_PRODUCTS)}`;

// Revenue of every active product in the months that end on day $4, from the
// best seller to the worst. Products that sold nothing come last, with zero.
const PRODUCT_RANKING_SQL = `
  WITH revenue AS (
    SELECT i.product_id, sum(i.quantity * i.unit_price) AS revenue
    FROM sales.orders o
    JOIN sales.distribution_centers dc ON dc.id = o.distribution_center_id
    JOIN sales.order_items i ON i.order_id = o.id
    WHERE o.status <> 'cancelled'
      AND o.ordered_at >= ${dayEnd('$4')} - interval '${String(ABC_WINDOW_MONTHS)} months'
      AND o.ordered_at < ${dayEnd('$4')}
      AND ${CENTER_FILTER}
    GROUP BY i.product_id
  )
  SELECT coalesce(revenue.revenue, 0) AS revenue
  FROM sales.products p
  LEFT JOIN revenue ON revenue.product_id = p.id
  WHERE p.active AND ${CATEGORY_FILTER}
  ORDER BY 1 DESC, p.id`;

// The instant each day of $4 ends, never later than now: stock in the future
// is the stock of now.
const INSTANTS_CTE = `
  instants AS (
    SELECT (ordinality - 1)::int AS position, least(${dayEnd('day')}, now()) AS instant
    FROM unnest($4::date[]) WITH ORDINALITY AS days (day, ordinality)
  )`;

// Stock at the end of each day of $4: the balance of today minus everything
// that moved after that instant. Returns the value at cost and how many
// balances were below their minimum.
const STOCK_TIMELINE_SQL = `
  WITH ${INSTANTS_CTE},
  ledger AS (${ledgerAfter('(SELECT min(instant) FROM instants)')}),
  moved_after AS (
    SELECT i.position, l.distribution_center_id, l.product_id, sum(l.quantity) AS quantity
    FROM ledger l
    JOIN instants i ON l.moved_at > i.instant
    GROUP BY 1, 2, 3
  ),
  balances AS (
    SELECT i.position, p.cost, s.minimum_quantity, p.active,
           s.quantity - coalesce(a.quantity, 0) AS quantity
    FROM sales.stock_levels s
    JOIN sales.distribution_centers dc ON dc.id = s.distribution_center_id
    JOIN sales.products p ON p.id = s.product_id
    CROSS JOIN instants i
    LEFT JOIN moved_after a
      ON a.position = i.position
     AND a.distribution_center_id = s.distribution_center_id
     AND a.product_id = s.product_id
    WHERE ${CENTER_FILTER} AND ${CATEGORY_FILTER}
  )
  SELECT position,
         coalesce(sum(quantity * cost), 0) AS value,
         count(*) FILTER (WHERE active AND quantity < minimum_quantity) AS below_minimum
  FROM balances
  GROUP BY position
  ORDER BY position`;

// Value of the stock at the end of day $4, by center and category.
const CENTER_STOCK_SQL = `
  WITH instant AS (SELECT least(${dayEnd('$4')}, now()) AS at),
  moved_after AS (
    SELECT l.distribution_center_id, l.product_id, sum(l.quantity) AS quantity
    FROM (${ledgerAfter('(SELECT at FROM instant)')}) l
    GROUP BY 1, 2
  )
  SELECT dc.id, dc.name, p.category,
         sum((s.quantity - coalesce(a.quantity, 0)) * p.cost) AS value
  FROM sales.stock_levels s
  JOIN sales.distribution_centers dc ON dc.id = s.distribution_center_id
  JOIN sales.products p ON p.id = s.product_id
  LEFT JOIN moved_after a
    ON a.distribution_center_id = s.distribution_center_id AND a.product_id = s.product_id
  WHERE ${CENTER_FILTER} AND ${CATEGORY_FILTER}
  GROUP BY dc.id, dc.name, p.category`;

// Balances that need attention at the end of day $4 ($5 = critical coverage in
// days, $6 = how far above the minimum still counts as "near"). Coverage is the
// balance divided by the average daily outflow of the window before that day.
const ALERTS_CTE = `
  WITH instant AS (SELECT least(${dayEnd('$4')}, now()) AS at),
  moved_after AS (
    SELECT l.distribution_center_id, l.product_id, sum(l.quantity) AS quantity
    FROM (${ledgerAfter('(SELECT at FROM instant)')}) l
    GROUP BY 1, 2
  ),
  outflow AS (
    SELECT m.distribution_center_id, m.product_id,
           sum(m.quantity) / ${String(COVERAGE_WINDOW_DAYS)}.0 AS daily
    FROM sales.stock_movements m
    WHERE m.type = 'outbound'
      AND m.moved_at <= (SELECT at FROM instant)
      AND m.moved_at > (SELECT at FROM instant) - interval '${String(COVERAGE_WINDOW_DAYS)} days'
    GROUP BY 1, 2
  ),
  balances AS (
    SELECT p.id AS product_id, p.name AS product, p.unit,
           dc.id AS distribution_center_id, dc.name AS distribution_center,
           s.quantity - coalesce(a.quantity, 0) AS quantity,
           s.minimum_quantity,
           CASE WHEN o.daily > 0
             THEN floor((s.quantity - coalesce(a.quantity, 0)) / o.daily)::int
           END AS coverage_days
    FROM sales.stock_levels s
    JOIN sales.distribution_centers dc ON dc.id = s.distribution_center_id
    JOIN sales.products p ON p.id = s.product_id
    LEFT JOIN moved_after a
      ON a.distribution_center_id = s.distribution_center_id AND a.product_id = s.product_id
    LEFT JOIN outflow o
      ON o.distribution_center_id = s.distribution_center_id AND o.product_id = s.product_id
    WHERE p.active AND ${CENTER_FILTER} AND ${CATEGORY_FILTER}
  ),
  alerts AS (
    SELECT balances.*,
           CASE
             WHEN quantity < minimum_quantity AND coverage_days <= $5::int THEN 'critical'
             WHEN quantity < minimum_quantity THEN 'attention'
             WHEN quantity < minimum_quantity * $6::numeric THEN 'ok'
           END AS status
    FROM balances
  )`;

const ALERT_COUNTS_SQL = `${ALERTS_CTE}
  SELECT status, count(*) AS total FROM alerts WHERE status IS NOT NULL GROUP BY status`;

// Most urgent first: by status, then by the days the stock still lasts.
const ALERT_ITEMS_SQL = `${ALERTS_CTE}
  SELECT product_id, product, unit, distribution_center_id, distribution_center,
         quantity, minimum_quantity, coverage_days, status
  FROM alerts
  WHERE status IS NOT NULL AND ($7::text IS NULL OR status = $7)
  ORDER BY array_position(ARRAY['critical', 'attention', 'ok'], status),
           coverage_days NULLS LAST, product, distribution_center
  LIMIT $8::int`;

// A movement belongs to a center when it is its origin or its destination.
const MOVEMENTS_SQL = `
  SELECT m.id, m.moved_at, m.type, p.name AS product, p.unit,
         dc.name AS distribution_center, destination.name AS destination_center,
         m.quantity, m.responsible_name, m.document
  FROM sales.stock_movements m
  JOIN sales.products p ON p.id = m.product_id
  JOIN sales.distribution_centers dc ON dc.id = m.distribution_center_id
  LEFT JOIN sales.distribution_centers destination ON destination.id = m.destination_center_id
  WHERE m.moved_at <= now()
    AND ($1::bigint IS NULL OR dc.id = $1 OR destination.id = $1)
    AND ($2::bigint IS NULL OR dc.region_id = $2 OR destination.region_id = $2)
    AND ${CATEGORY_FILTER}
    AND ($4::text IS NULL OR m.type = $4)
  ORDER BY m.moved_at DESC, m.id DESC
  LIMIT $5::int`;

export interface DailySales {
  day: string;
  revenue: number;
  orders: number;
}

export interface DailyOutflow {
  day: string;
  cost: number;
}

export interface DailyDeliveries {
  day: string;
  delivered: number;
  onTime: number;
}

export interface RegionRevenueRow {
  regionId: string;
  name: string;
  revenue: number;
  previousRevenue: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  category: string;
  revenue: number;
  // Revenue of all products in the period.
  total: number;
}

export interface StockSnapshot {
  value: number;
  belowMinimum: number;
}

export interface CenterCategoryStock {
  distributionCenterId: string;
  name: string;
  category: string;
  value: number;
}

function filterValues(filters: DashboardFilters): (string | null)[] {
  return [filters.distributionCenterId ?? null, filters.regionId ?? null, filters.category ?? null];
}

// Reads `sales` for the dashboard, with fixed statements on the read-only
// pool (D-54). PostgreSQL sends numeric and bigint as text: they are turned
// into numbers here, once.
@Injectable()
export class DashboardRepository {
  constructor(@Inject(FixedReadQuery) private readonly query: FixedReadQuery) {}

  async filterOptions(): Promise<DashboardFilterOptions> {
    const centers = await this.query.rows<{ id: string; name: string; region_id: string }>(
      FILTER_OPTIONS_SQL.centers,
    );
    const regions = await this.query.rows<{ id: string; name: string }>(FILTER_OPTIONS_SQL.regions);
    const categories = await this.query.rows<{ category: string }>(FILTER_OPTIONS_SQL.categories);
    return {
      distributionCenters: centers.map((row) => ({
        id: row.id,
        name: row.name,
        regionId: row.region_id,
      })),
      regions,
      categories: categories.map((row) => row.category),
    };
  }

  async dailySales(filters: DashboardFilters, range: DashboardRange): Promise<DailySales[]> {
    const rows = await this.query.rows<{ day: string; revenue: string; orders: string }>(
      DAILY_SALES_SQL,
      [...filterValues(filters), range.from, range.to],
    );
    return rows.map((row) => ({
      day: row.day,
      revenue: Number(row.revenue),
      orders: Number(row.orders),
    }));
  }

  async dailyOutflow(filters: DashboardFilters, range: DashboardRange): Promise<DailyOutflow[]> {
    const rows = await this.query.rows<{ day: string; cost: string }>(DAILY_OUTFLOW_SQL, [
      ...filterValues(filters),
      range.from,
      range.to,
    ]);
    return rows.map((row) => ({ day: row.day, cost: Number(row.cost) }));
  }

  async dailyDeliveries(
    filters: DashboardFilters,
    range: DashboardRange,
  ): Promise<DailyDeliveries[]> {
    const rows = await this.query.rows<{ day: string; delivered: string; on_time: string }>(
      DAILY_DELIVERIES_SQL,
      [...filterValues(filters), range.from, range.to],
    );
    return rows.map((row) => ({
      day: row.day,
      delivered: Number(row.delivered),
      onTime: Number(row.on_time),
    }));
  }

  async regionRevenue(
    filters: DashboardFilters,
    range: DashboardRange,
    previousRange: DashboardRange,
  ): Promise<RegionRevenueRow[]> {
    const rows = await this.query.rows<{
      id: string;
      name: string;
      revenue: string;
      previous_revenue: string;
    }>(REGION_REVENUE_SQL, [...filterValues(filters), previousRange.from, range.from, range.to]);
    return rows.map((row) => ({
      regionId: row.id,
      name: row.name,
      revenue: Number(row.revenue),
      previousRevenue: Number(row.previous_revenue),
    }));
  }

  async topProducts(filters: DashboardFilters, range: DashboardRange): Promise<TopProductRow[]> {
    const rows = await this.query.rows<{
      id: string;
      name: string;
      category: string;
      revenue: string;
      total: string;
    }>(TOP_PRODUCTS_SQL, [...filterValues(filters), range.from, range.to]);
    return rows.map((row) => ({
      productId: row.id,
      name: row.name,
      category: row.category,
      revenue: Number(row.revenue),
      total: Number(row.total),
    }));
  }

  // Revenue of each active product in the 12 months that end on `day`, highest first.
  async productRanking(filters: DashboardFilters, day: string): Promise<number[]> {
    const rows = await this.query.rows<{ revenue: string }>(PRODUCT_RANKING_SQL, [
      ...filterValues(filters),
      day,
    ]);
    return rows.map((row) => Number(row.revenue));
  }

  // The stock at the end of each of `days`, in the same order.
  async stockTimeline(filters: DashboardFilters, days: string[]): Promise<StockSnapshot[]> {
    const rows = await this.query.rows<{ position: number; value: string; below_minimum: string }>(
      STOCK_TIMELINE_SQL,
      [...filterValues(filters), days],
    );
    const byPosition = new Map(rows.map((row) => [row.position, row]));
    return days.map((_day, position) => {
      const row = byPosition.get(position);
      return {
        value: Number(row?.value ?? 0),
        belowMinimum: Number(row?.below_minimum ?? 0),
      };
    });
  }

  async centerStock(filters: DashboardFilters, day: string): Promise<CenterCategoryStock[]> {
    const rows = await this.query.rows<{
      id: string;
      name: string;
      category: string;
      value: string;
    }>(CENTER_STOCK_SQL, [...filterValues(filters), day]);
    return rows.map((row) => ({
      distributionCenterId: row.id,
      name: row.name,
      category: row.category,
      value: Number(row.value),
    }));
  }

  async alertCounts(
    filters: DashboardFilters,
    day: string,
  ): Promise<Record<StockAlertStatus, number>> {
    const rows = await this.query.rows<{ status: StockAlertStatus; total: string }>(
      ALERT_COUNTS_SQL,
      [...filterValues(filters), day, CRITICAL_COVERAGE_DAYS, NEAR_MINIMUM_FACTOR],
    );
    const counts: Record<StockAlertStatus, number> = { critical: 0, attention: 0, ok: 0 };
    for (const row of rows) {
      counts[row.status] = Number(row.total);
    }
    return counts;
  }

  async alerts(
    filters: DashboardFilters,
    day: string,
    status: StockAlertStatus | undefined,
    limit: number,
  ): Promise<StockAlert[]> {
    const rows = await this.query.rows<{
      product_id: string;
      product: string;
      unit: string;
      distribution_center_id: string;
      distribution_center: string;
      // integer minus a bigint sum: PostgreSQL sends it as text.
      quantity: string;
      minimum_quantity: number;
      coverage_days: number | null;
      status: StockAlertStatus;
    }>(ALERT_ITEMS_SQL, [
      ...filterValues(filters),
      day,
      CRITICAL_COVERAGE_DAYS,
      NEAR_MINIMUM_FACTOR,
      status ?? null,
      limit,
    ]);
    return rows.map((row) => ({
      productId: row.product_id,
      product: row.product,
      unit: row.unit,
      distributionCenterId: row.distribution_center_id,
      distributionCenter: row.distribution_center,
      quantity: Number(row.quantity),
      minimumQuantity: row.minimum_quantity,
      coverageDays: row.coverage_days,
      status: row.status,
    }));
  }

  async movements(
    filters: DashboardFilters,
    type: StockMovementType | undefined,
    limit: number,
  ): Promise<StockMovement[]> {
    const rows = await this.query.rows<{
      id: string;
      moved_at: Date;
      type: StockMovementType;
      product: string;
      unit: string;
      distribution_center: string;
      destination_center: string | null;
      quantity: number;
      responsible_name: string;
      document: string;
    }>(MOVEMENTS_SQL, [...filterValues(filters), type ?? null, limit]);
    return rows.map((row) => ({
      id: row.id,
      movedAt: row.moved_at.toISOString(),
      type: row.type,
      product: row.product,
      unit: row.unit,
      distributionCenter: row.distribution_center,
      ...(row.destination_center !== null && { destinationCenter: row.destination_center }),
      quantity: row.quantity,
      responsibleName: row.responsible_name,
      document: row.document,
    }));
  }
}
