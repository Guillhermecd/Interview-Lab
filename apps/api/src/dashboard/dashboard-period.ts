import type { DashboardPeriod, DashboardRange } from '@interview-lab/shared';

// Days are counted in the time zone of the business (D-57), whatever the time
// zone of the server or of the browser.
export const DASHBOARD_TIME_ZONE = 'America/Sao_Paulo';

const MILLISECONDS_PER_DAY = 86_400_000;
const MONTHS_PER_QUARTER = 3;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;

export interface ResolvedPeriod {
  period: DashboardPeriod;
  range: DashboardRange;
  // The same number of days, ending the day before `range` starts.
  previousRange: DashboardRange;
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: DASHBOARD_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// The calendar day (YYYY-MM-DD) that `instant` falls on for the business.
export function businessDay(instant: Date): string {
  return dayFormat.format(instant);
}

// Calendar days are handled as UTC midnights: only the date part matters.
function toDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 'YYYY-MM-DD'.length);
}

export function addDays(day: string, days: number): string {
  return toDay(new Date(toDate(day).getTime() + days * MILLISECONDS_PER_DAY));
}

// Number of days from `from` to `to`, both included.
export function daysInRange(range: DashboardRange): number {
  return (
    Math.round((toDate(range.to).getTime() - toDate(range.from).getTime()) / MILLISECONDS_PER_DAY) +
    1
  );
}

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = toDate(value);
  return !Number.isNaN(date.getTime()) && toDay(date) === value;
}

function startOf(period: 'month' | 'quarter' | 'year', today: string): string {
  const date = toDate(today);
  const month = date.getUTCMonth();
  const firstMonth =
    period === 'year' ? 0 : period === 'quarter' ? month - (month % MONTHS_PER_QUARTER) : month;
  return toDay(new Date(Date.UTC(date.getUTCFullYear(), firstMonth, 1)));
}

function rangeOf(period: DashboardPeriod, today: string, custom?: DashboardRange): DashboardRange {
  switch (period) {
    case '7d':
      return { from: addDays(today, -(WEEK_DAYS - 1)), to: today };
    case '30d':
      return { from: addDays(today, -(MONTH_DAYS - 1)), to: today };
    case 'month':
    case 'quarter':
    case 'year':
      // To date: the period is still running.
      return { from: startOf(period, today), to: today };
    case 'custom':
      if (!custom) {
        throw new Error('A custom period needs its range');
      }
      return custom;
  }
}

// The days the dashboard covers, and the period it is compared with: the same
// number of days right before.
export function resolvePeriod(
  period: DashboardPeriod,
  today: string,
  custom?: DashboardRange,
): ResolvedPeriod {
  const range = rangeOf(period, today, custom);
  const days = daysInRange(range);
  return {
    period,
    range,
    previousRange: { from: addDays(range.from, -days), to: addDays(range.from, -1) },
  };
}

// Splits the range into at most `count` consecutive parts of similar length,
// for the small charts of the indicators.
export function splitRange(range: DashboardRange, count: number): DashboardRange[] {
  const days = daysInRange(range);
  const parts = Math.min(count, days);
  return Array.from({ length: parts }, (_part, index) => ({
    from: addDays(range.from, Math.floor((days * index) / parts)),
    to: addDays(range.from, Math.floor((days * (index + 1)) / parts) - 1),
  }));
}

export function daysOf(range: DashboardRange): string[] {
  return Array.from({ length: daysInRange(range) }, (_day, index) => addDays(range.from, index));
}
