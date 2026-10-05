import { describe, expect, it } from 'vitest';
import {
  buildAbcCurve,
  difference,
  percentChange,
  percentOf,
  roundMoney,
  sentimentOf,
  trendOf,
} from './dashboard-rules.js';

describe('comparisons', () => {
  it('computes the change in percent, to one decimal', () => {
    expect(percentChange(400, 250)).toBe(60);
    expect(percentChange(12_960, 13_190)).toBe(-1.7);
    expect(percentChange(100, 100)).toBe(0);
  });

  it('has no change without a base to compare with', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(100, null)).toBeNull();
    expect(percentChange(null, 100)).toBeNull();
  });

  it('computes a difference in the unit of the indicator', () => {
    expect(difference(563, 1099, 0)).toBe(-536);
    expect(difference(92.4, 94.2, 1)).toBe(-1.8);
    expect(difference(null, 3, 0)).toBeNull();
  });

  it('computes a share, or nothing when the total is zero', () => {
    expect(percentOf(2, 3)).toBe(66.7);
    expect(percentOf(0, 0)).toBeNull();
  });

  it('rounds money to cents', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1234.567)).toBe(1234.57);
  });
});

describe('trend and sentiment', () => {
  it('reads the direction of a change, treating a tiny one as flat', () => {
    expect(trendOf(1.8)).toBe('up');
    expect(trendOf(-0.1)).toBe('down');
    expect(trendOf(0)).toBe('flat');
    expect(trendOf(0.04)).toBe('flat');
    expect(trendOf(null)).toBe('flat');
  });

  it('judges a change by what a rise means for the indicator', () => {
    // Revenue: up is good.
    expect(sentimentOf('up', 'good')).toBe('good');
    expect(sentimentOf('down', 'good')).toBe('bad');
    // Days of stock, products below the minimum: up is bad.
    expect(sentimentOf('up', 'bad')).toBe('bad');
    expect(sentimentOf('down', 'bad')).toBe('good');
    // Stock value: neither.
    expect(sentimentOf('up', 'neutral')).toBe('neutral');
    expect(sentimentOf('flat', 'good')).toBe('neutral');
  });
});

describe('buildAbcCurve', () => {
  const revenues = (values: number[]) => values.map((revenue) => ({ revenue }));

  it('puts a product in the class where its revenue starts', () => {
    // Shares before each product: 0%, 50%, 80%, 95%.
    const curve = buildAbcCurve(revenues([50, 30, 15, 5]));

    expect(curve.classes).toEqual([
      { class: 'A', products: 2, revenueSharePercent: 80 },
      { class: 'B', products: 1, revenueSharePercent: 15 },
      { class: 'C', products: 1, revenueSharePercent: 5 },
    ]);
    expect(curve.activeProducts).toBe(4);
    expect(curve.classAEndPercent).toBe(50);
    expect(curve.classBEndPercent).toBe(75);
  });

  it('draws the cumulative curve from the origin to 100%', () => {
    const curve = buildAbcCurve(revenues([1300, 300, 50]));

    expect(curve.points).toEqual([
      { productsPercent: 0, revenuePercent: 0 },
      { productsPercent: 33.3, revenuePercent: 78.8 },
      { productsPercent: 66.7, revenuePercent: 97 },
      { productsPercent: 100, revenuePercent: 100 },
    ]);
  });

  it('puts products without sales in class C', () => {
    const curve = buildAbcCurve(revenues([100, 0, 0]));

    expect(curve.classes.map((item) => item.products)).toEqual([1, 0, 2]);
    expect(curve.classes[2]?.revenueSharePercent).toBe(0);
  });

  it('classifies everything as C when nothing was sold', () => {
    const curve = buildAbcCurve(revenues([0, 0]));

    expect(curve.classes.map((item) => item.products)).toEqual([0, 0, 2]);
    expect(curve.points.at(-1)).toEqual({ productsPercent: 100, revenuePercent: 0 });
  });

  it('handles a catalog with no products', () => {
    const curve = buildAbcCurve([]);

    expect(curve.activeProducts).toBe(0);
    expect(curve.points).toEqual([{ productsPercent: 0, revenuePercent: 0 }]);
    expect(curve.classAEndPercent).toBe(0);
  });

  it('thins a long curve but always keeps its last point', () => {
    const curve = buildAbcCurve(
      revenues(Array.from({ length: 1000 }, (_item, index) => 1000 - index)),
    );

    expect(curve.points.length).toBeLessThanOrEqual(62);
    expect(curve.points.at(-1)).toEqual({ productsPercent: 100, revenuePercent: 100 });
  });
});
