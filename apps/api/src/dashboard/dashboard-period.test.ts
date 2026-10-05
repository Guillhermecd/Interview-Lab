import { describe, expect, it } from 'vitest';
import {
  addDays,
  businessDay,
  daysInRange,
  daysOf,
  isCalendarDay,
  resolvePeriod,
  splitRange,
} from './dashboard-period.js';

const TODAY = '2026-09-30';

describe('businessDay', () => {
  it('uses the day of the business, not the UTC day', () => {
    // 01:30 UTC is still the evening before in São Paulo (UTC-3).
    expect(businessDay(new Date('2026-10-01T01:30:00.000Z'))).toBe('2026-09-30');
    expect(businessDay(new Date('2026-10-01T03:00:00.000Z'))).toBe('2026-10-01');
  });
});

describe('resolvePeriod', () => {
  it.each([
    ['7d', { from: '2026-09-24', to: TODAY }, { from: '2026-09-17', to: '2026-09-23' }],
    ['30d', { from: '2026-09-01', to: TODAY }, { from: '2026-08-02', to: '2026-08-31' }],
    ['month', { from: '2026-09-01', to: TODAY }, { from: '2026-08-02', to: '2026-08-31' }],
    ['quarter', { from: '2026-07-01', to: TODAY }, { from: '2026-03-31', to: '2026-06-30' }],
    ['year', { from: '2026-01-01', to: TODAY }, { from: '2025-04-03', to: '2025-12-31' }],
  ] as const)(
    'resolves "%s" to date and the same number of days before',
    (period, range, previousRange) => {
      expect(resolvePeriod(period, TODAY)).toEqual({ period, range, previousRange });
    },
  );

  it('starts the quarter and the month on the right day early in the year', () => {
    expect(resolvePeriod('quarter', '2026-01-15').range).toEqual({
      from: '2026-01-01',
      to: '2026-01-15',
    });
    expect(resolvePeriod('month', '2026-03-01').range).toEqual({
      from: '2026-03-01',
      to: '2026-03-01',
    });
  });

  it('uses the custom range as given', () => {
    const custom = { from: '2026-03-11', to: '2026-03-20' };

    expect(resolvePeriod('custom', TODAY, custom)).toEqual({
      period: 'custom',
      range: custom,
      previousRange: { from: '2026-03-01', to: '2026-03-10' },
    });
  });

  it('compares a single day with the day before', () => {
    const day = { from: '2026-03-01', to: '2026-03-01' };

    expect(resolvePeriod('custom', TODAY, day).previousRange).toEqual({
      from: '2026-02-28',
      to: '2026-02-28',
    });
  });

  it('refuses a custom period without its range', () => {
    expect(() => resolvePeriod('custom', TODAY)).toThrow();
  });
});

describe('calendar helpers', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts the days of a range, both ends included', () => {
    expect(daysInRange({ from: '2026-03-11', to: '2026-03-20' })).toBe(10);
    expect(daysInRange({ from: '2026-03-11', to: '2026-03-11' })).toBe(1);
  });

  it('lists the days of a range', () => {
    expect(daysOf({ from: '2026-02-27', to: '2026-03-01' })).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it.each([
    ['2026-03-11', true],
    ['2026-02-30', false],
    ['2026-13-01', false],
    ['11/03/2026', false],
    ['2026-3-1', false],
    ['', false],
  ])('checks whether "%s" is a calendar day', (value, expected) => {
    expect(isCalendarDay(value)).toBe(expected);
  });
});

describe('splitRange', () => {
  it('covers the whole range with consecutive parts', () => {
    const parts = splitRange({ from: '2026-03-11', to: '2026-03-20' }, 7);

    expect(parts).toEqual([
      { from: '2026-03-11', to: '2026-03-11' },
      { from: '2026-03-12', to: '2026-03-12' },
      { from: '2026-03-13', to: '2026-03-14' },
      { from: '2026-03-15', to: '2026-03-15' },
      { from: '2026-03-16', to: '2026-03-17' },
      { from: '2026-03-18', to: '2026-03-18' },
      { from: '2026-03-19', to: '2026-03-20' },
    ]);
  });

  it('never makes more parts than days', () => {
    expect(splitRange({ from: '2026-03-11', to: '2026-03-13' }, 7)).toHaveLength(3);
    expect(splitRange({ from: '2026-03-11', to: '2026-03-11' }, 7)).toEqual([
      { from: '2026-03-11', to: '2026-03-11' },
    ]);
  });

  it('ends on the last day whatever the length', () => {
    const range = { from: '2026-01-01', to: '2026-09-30' };

    expect(splitRange(range, 7).at(-1)?.to).toBe(range.to);
    expect(splitRange(range, 7)[0]?.from).toBe(range.from);
  });
});
