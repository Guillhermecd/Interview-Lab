import { Inject, Injectable } from '@nestjs/common';
import type {
  CenterStock,
  DashboardFilterOptions,
  DashboardKpis,
  DashboardOverview,
  DashboardPeriod,
  DashboardRange,
  RegionRevenue,
  RevenuePoint,
  StockAlertList,
  StockAlertStatus,
  StockMovementList,
  StockMovementType,
  TopProducts,
} from '@interview-lab/shared';
import type { DashboardEnv } from '../config/env.js';
import {
  addDays,
  businessDay,
  daysInRange,
  daysOf,
  resolvePeriod,
  splitRange,
} from './dashboard-period.js';
import {
  buildAbcCurve,
  DAYS_PER_YEAR,
  difference,
  percentChange,
  percentOf,
  roundMoney,
  roundTo,
  sentimentOf,
  SPARK_POINTS,
  trendOf,
  type RiseMeaning,
} from './dashboard-rules.js';
import {
  DashboardRepository,
  type CenterCategoryStock,
  type DailyDeliveries,
  type DailyOutflow,
  type DailySales,
  type DashboardFilters,
  type StockSnapshot,
} from './dashboard.repository.js';

export const DASHBOARD_ENV = Symbol('DASHBOARD_ENV');

export interface OverviewRequest {
  filters: DashboardFilters;
  period: DashboardPeriod;
  // Only for the custom period.
  custom?: DashboardRange | undefined;
}

function inRange(day: string, range: DashboardRange): boolean {
  return day >= range.from && day <= range.to;
}

function sumOf<Row>(
  rows: Row[],
  range: DashboardRange,
  day: (row: Row) => string,
  value: (row: Row) => number,
): number {
  return rows.reduce((sum, row) => (inRange(day(row), range) ? sum + value(row) : sum), 0);
}

function comparison(
  value: number | null,
  previousValue: number | null,
  delta: number | null,
  rise: RiseMeaning,
) {
  const trend = trendOf(delta);
  return { value, previousValue, delta, trend, sentiment: sentimentOf(trend, rise) };
}

// Turns what the repository read into what the dashboard shows. Totals,
// comparisons, trends and statuses are all decided here (the client only
// formats them), following the rules of dashboard-rules.ts.
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DashboardRepository) private readonly repository: DashboardRepository,
    @Inject(DASHBOARD_ENV) private readonly env: DashboardEnv,
  ) {}

  filterOptions(): Promise<DashboardFilterOptions> {
    return this.repository.filterOptions();
  }

  // `now` is a parameter so the period can be tested at any date.
  async overview(request: OverviewRequest, now: Date = new Date()): Promise<DashboardOverview> {
    const { filters } = request;
    const { period, range, previousRange } = resolvePeriod(
      request.period,
      businessDay(now),
      request.custom,
    );
    const both = { from: previousRange.from, to: range.to };
    const sparkParts = splitRange(range, SPARK_POINTS);
    // Stock at the end of the previous period, then at the end of each part.
    const stockDays = [previousRange.to, ...sparkParts.map((part) => part.to)];

    // The read-only pool is shared with the chat: the statements run in small
    // batches instead of all at once.
    const [sales, outflow, deliveries] = await Promise.all([
      this.repository.dailySales(filters, both),
      this.repository.dailyOutflow(filters, both),
      this.repository.dailyDeliveries(filters, both),
    ]);
    const [stock, centerStock, alertCounts] = await Promise.all([
      this.repository.stockTimeline(filters, stockDays),
      this.repository.centerStock(filters, range.to),
      this.repository.alertCounts(filters, range.to),
    ]);
    const [regions, top, ranking, options] = await Promise.all([
      this.repository.regionRevenue(filters, range, previousRange),
      this.repository.topProducts(filters, range),
      this.repository.productRanking(filters, range.to),
      this.repository.filterOptions(),
    ]);

    const abc = buildAbcCurve(ranking.map((revenue) => ({ revenue })));
    const stockByCenter = this.stockByCenter(centerStock, options.categories);

    return {
      period,
      range,
      previousRange,
      dataUntil: now.toISOString(),
      categories: options.categories,
      kpis: {
        ...this.salesKpis(sales, range, previousRange, sparkParts),
        ...this.stockKpis(stock, outflow, range, previousRange, sparkParts, {
          distributionCenters: stockByCenter.length,
          activeProducts: abc.activeProducts,
          critical: alertCounts.critical,
          attention: alertCounts.attention,
        }),
        onTimeDelivery: this.onTimeKpi(deliveries, range, previousRange, sparkParts),
      },
      revenueSeries: this.revenueSeries(sales, range, previousRange),
      revenueByRegion: regions.map((region): RegionRevenue => ({
        regionId: region.regionId,
        name: region.name,
        revenue: roundMoney(region.revenue),
        previousRevenue: roundMoney(region.previousRevenue),
        ...this.regionChange(region.revenue, region.previousRevenue),
      })),
      topProducts: this.topProducts(top),
      stockByCenter,
      abc,
    };
  }

  async stockAlerts(
    filters: DashboardFilters,
    status: StockAlertStatus | undefined,
    limit: number,
    now: Date = new Date(),
  ): Promise<StockAlertList> {
    const today = businessDay(now);
    const counts = await this.repository.alertCounts(filters, today);
    const items = await this.repository.alerts(filters, today, status, limit);
    return {
      counts: { ...counts, all: counts.critical + counts.attention + counts.ok },
      items,
    };
  }

  async stockMovements(
    filters: DashboardFilters,
    type: StockMovementType | undefined,
    limit: number,
  ): Promise<StockMovementList> {
    return { items: await this.repository.movements(filters, type, limit) };
  }

  private regionChange(revenue: number, previousRevenue: number) {
    const deltaPercent = percentChange(revenue, previousRevenue);
    const trend = trendOf(deltaPercent);
    return { deltaPercent, trend, sentiment: sentimentOf(trend, 'good') };
  }

  private salesKpis(
    sales: DailySales[],
    range: DashboardRange,
    previousRange: DashboardRange,
    sparkParts: DashboardRange[],
  ): Pick<DashboardKpis, 'revenue' | 'orders'> {
    const revenueIn = (part: DashboardRange) =>
      roundMoney(
        sumOf(
          sales,
          part,
          (row) => row.day,
          (row) => row.revenue,
        ),
      );
    const ordersIn = (part: DashboardRange) =>
      sumOf(
        sales,
        part,
        (row) => row.day,
        (row) => row.orders,
      );
    const ticket = (revenue: number, orders: number) =>
      orders === 0 ? null : roundMoney(revenue / orders);

    const revenue = revenueIn(range);
    const previousRevenue = revenueIn(previousRange);
    const orders = ordersIn(range);
    const previousOrders = ordersIn(previousRange);
    const averageTicket = ticket(revenue, orders);

    return {
      revenue: {
        ...comparison(revenue, previousRevenue, percentChange(revenue, previousRevenue), 'good'),
        spark: sparkParts.map(revenueIn),
      },
      orders: {
        ...comparison(orders, previousOrders, percentChange(orders, previousOrders), 'good'),
        spark: sparkParts.map(ordersIn),
        averageTicket,
        averageTicketDeltaPercent: percentChange(
          averageTicket,
          ticket(previousRevenue, previousOrders),
        ),
      },
    };
  }

  private stockKpis(
    stock: StockSnapshot[],
    outflow: DailyOutflow[],
    range: DashboardRange,
    previousRange: DashboardRange,
    sparkParts: DashboardRange[],
    details: {
      distributionCenters: number;
      activeProducts: number;
      critical: number;
      attention: number;
    },
  ): Pick<DashboardKpis, 'stockValue' | 'coverageDays' | 'belowMinimum'> {
    // stock[0] is the end of the previous period; the rest follow sparkParts.
    const atStart = stock[0];
    const alongPeriod = stock.slice(1);
    const atEnd = alongPeriod.at(-1);
    const value = atEnd ? roundMoney(atEnd.value) : null;
    const previousValue = atStart ? roundMoney(atStart.value) : null;

    // Days the stock lasts if it keeps leaving at the pace of the part.
    const coverage = (stockValue: number | undefined, part: DashboardRange) => {
      const cost = sumOf(
        outflow,
        part,
        (row) => row.day,
        (row) => row.cost,
      );
      return stockValue === undefined || cost === 0
        ? null
        : roundTo(stockValue / (cost / daysInRange(part)), 0);
    };
    const coverageDays = coverage(atEnd?.value, range);
    const previousCoverageDays = coverage(atStart?.value, previousRange);
    const coverageSpark = sparkParts.map((part, index) =>
      coverage(alongPeriod[index]?.value, part),
    );

    const belowMinimum = atEnd?.belowMinimum ?? null;
    const previousBelowMinimum = atStart?.belowMinimum ?? null;

    return {
      stockValue: {
        ...comparison(value, previousValue, percentChange(value, previousValue), 'neutral'),
        spark: alongPeriod.map((snapshot) => roundMoney(snapshot.value)),
        distributionCenters: details.distributionCenters,
        activeProducts: details.activeProducts,
      },
      coverageDays: {
        ...comparison(
          coverageDays,
          previousCoverageDays,
          difference(coverageDays, previousCoverageDays, 0),
          'bad',
        ),
        // A part without any outflow has no coverage: no chart rather than a gap.
        spark: coverageSpark.every((days) => days !== null) ? coverageSpark : [],
        turnsPerYear:
          coverageDays === null || coverageDays === 0
            ? null
            : roundTo(DAYS_PER_YEAR / coverageDays, 1),
      },
      belowMinimum: {
        ...comparison(
          belowMinimum,
          previousBelowMinimum,
          difference(belowMinimum, previousBelowMinimum, 0),
          'bad',
        ),
        spark: alongPeriod.map((snapshot) => snapshot.belowMinimum),
        critical: details.critical,
        attention: details.attention,
      },
    };
  }

  private onTimeKpi(
    deliveries: DailyDeliveries[],
    range: DashboardRange,
    previousRange: DashboardRange,
    sparkParts: DashboardRange[],
  ): DashboardKpis['onTimeDelivery'] {
    const delivered = (part: DashboardRange) =>
      sumOf(
        deliveries,
        part,
        (row) => row.day,
        (row) => row.delivered,
      );
    const onTime = (part: DashboardRange) =>
      sumOf(
        deliveries,
        part,
        (row) => row.day,
        (row) => row.onTime,
      );
    const percent = (part: DashboardRange) => percentOf(onTime(part), delivered(part));

    const value = percent(range);
    const previousValue = percent(previousRange);
    const spark = sparkParts.map(percent);

    return {
      ...comparison(value, previousValue, difference(value, previousValue, 1), 'good'),
      spark: spark.every((point) => point !== null) ? spark : [],
      targetPercent: this.env.onTimeTargetPercent,
      onTimeOrders: onTime(range),
      deliveredOrders: delivered(range),
    };
  }

  // Each day of the period beside the day in the same position of the previous one.
  private revenueSeries(
    sales: DailySales[],
    range: DashboardRange,
    previousRange: DashboardRange,
  ): RevenuePoint[] {
    const byDay = new Map(sales.map((row) => [row.day, row.revenue]));
    let cumulative = 0;
    let previousCumulative = 0;
    return daysOf(range).map((date, index) => {
      const previousDate = addDays(previousRange.from, index);
      const revenue = byDay.get(date) ?? 0;
      const previousRevenue = byDay.get(previousDate) ?? 0;
      cumulative += revenue;
      previousCumulative += previousRevenue;
      return {
        date,
        revenue: roundMoney(revenue),
        cumulative: roundMoney(cumulative),
        previousDate,
        previousRevenue: roundMoney(previousRevenue),
        previousCumulative: roundMoney(previousCumulative),
      };
    });
  }

  private topProducts(rows: Awaited<ReturnType<DashboardRepository['topProducts']>>): TopProducts {
    const total = rows[0]?.total ?? 0;
    const shown = rows.reduce((sum, row) => sum + row.revenue, 0);
    return {
      items: rows.map((row) => ({
        productId: row.productId,
        name: row.name,
        category: row.category,
        revenue: roundMoney(row.revenue),
      })),
      sharePercent: percentOf(shown, total),
    };
  }

  // One row per center, biggest stock first, with its value in each category.
  private stockByCenter(rows: CenterCategoryStock[], categories: string[]): CenterStock[] {
    const centers = new Map<string, CenterStock>();
    for (const row of rows) {
      const center = centers.get(row.distributionCenterId) ?? {
        distributionCenterId: row.distributionCenterId,
        name: row.name,
        total: 0,
        byCategory: categories.map(() => 0),
      };
      const position = categories.indexOf(row.category);
      if (position !== -1) {
        center.byCategory[position] = roundMoney(row.value);
      }
      center.total = roundMoney(center.total + row.value);
      centers.set(row.distributionCenterId, center);
    }
    return [...centers.values()].sort(
      (first, second) => second.total - first.total || first.name.localeCompare(second.name),
    );
  }
}
