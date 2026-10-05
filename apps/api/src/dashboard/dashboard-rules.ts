import type { AbcClass, AbcCurve, KpiSentiment, KpiTrend } from '@interview-lab/shared';

// Business rules of the dashboard (D-57), in one place.

// Stock alerts. Coverage is the stock divided by the average daily outflow of
// the last 30 days.
export const COVERAGE_WINDOW_DAYS = 30;
// Below the minimum and lasting at most this many days: critical.
export const CRITICAL_COVERAGE_DAYS = 5;
// At or above the minimum, but less than this much above it: listed as "ok",
// so it is seen before it becomes an alert.
export const NEAR_MINIMUM_FACTOR = 1.2;

// ABC curve: products ranked by revenue. Class A holds the ones that open the
// first 80% of the revenue, class B the next 15%, class C the rest.
export const ABC_CLASS_A_SHARE = 0.8;
export const ABC_CLASS_B_SHARE = 0.95;
export const ABC_WINDOW_MONTHS = 12;
const ABC_MAX_POINTS = 60;

export const TOP_PRODUCTS = 10;
export const SPARK_POINTS = 7;
export const DAYS_PER_YEAR = 365;

const PERCENT = 100;
const CENTS = 100;
// A change smaller than this (in the unit of the indicator) is shown as flat.
const FLAT_BELOW = 0.05;

export function roundMoney(value: number): number {
  return Math.round(value * CENTS) / CENTS;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Change of `current` against `previous`, in percent. Null without a base.
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  return roundTo(((current - previous) / Math.abs(previous)) * PERCENT, 1);
}

export function difference(
  current: number | null,
  previous: number | null,
  decimals: number,
): number | null {
  return current === null || previous === null ? null : roundTo(current - previous, decimals);
}

export function percentOf(part: number, total: number): number | null {
  return total === 0 ? null : roundTo((part / total) * PERCENT, 1);
}

export function trendOf(delta: number | null): KpiTrend {
  if (delta === null || Math.abs(delta) < FLAT_BELOW) {
    return 'flat';
  }
  return delta > 0 ? 'up' : 'down';
}

// What a rise means for each indicator.
export type RiseMeaning = 'good' | 'bad' | 'neutral';

export function sentimentOf(trend: KpiTrend, rise: RiseMeaning): KpiSentiment {
  if (trend === 'flat' || rise === 'neutral') {
    return 'neutral';
  }
  return (trend === 'up') === (rise === 'good') ? 'good' : 'bad';
}

export interface RankedProduct {
  // Revenue of the product, from the best seller to the worst.
  revenue: number;
}

function classOf(shareBefore: number): AbcClass {
  if (shareBefore < ABC_CLASS_A_SHARE) {
    return 'A';
  }
  return shareBefore < ABC_CLASS_B_SHARE ? 'B' : 'C';
}

// Classifies the products, already sorted by revenue (highest first), and
// draws the cumulative curve. A product belongs to the class in which its
// revenue starts; without any revenue, every product is class C.
export function buildAbcCurve(products: RankedProduct[]): AbcCurve {
  const total = products.reduce((sum, product) => sum + product.revenue, 0);
  const count = products.length;
  const tally: Record<AbcClass, { products: number; revenue: number }> = {
    A: { products: 0, revenue: 0 },
    B: { products: 0, revenue: 0 },
    C: { products: 0, revenue: 0 },
  };

  const cumulativeShares: number[] = [];
  let cumulative = 0;
  for (const product of products) {
    const abcClass = total === 0 ? 'C' : classOf(cumulative / total);
    tally[abcClass].products += 1;
    tally[abcClass].revenue += product.revenue;
    cumulative += product.revenue;
    cumulativeShares.push(total === 0 ? 0 : cumulative / total);
  }

  // The curve keeps at most ABC_MAX_POINTS points, always including the last.
  const step = Math.max(1, Math.ceil(count / ABC_MAX_POINTS));
  const points = [{ productsPercent: 0, revenuePercent: 0 }];
  cumulativeShares.forEach((share, index) => {
    const position = index + 1;
    if (position % step === 0 || position === count) {
      points.push({
        productsPercent: roundTo((position / count) * PERCENT, 1),
        revenuePercent: roundTo(share * PERCENT, 1),
      });
    }
  });

  const endPercent = (products: number) =>
    count === 0 ? 0 : roundTo((products / count) * PERCENT, 1);
  return {
    activeProducts: count,
    classes: (['A', 'B', 'C'] as const).map((abcClass) => ({
      class: abcClass,
      products: tally[abcClass].products,
      revenueSharePercent: percentOf(tally[abcClass].revenue, total) ?? 0,
    })),
    points,
    classAEndPercent: endPercent(tally.A.products),
    classBEndPercent: endPercent(tally.A.products + tally.B.products),
  };
}
