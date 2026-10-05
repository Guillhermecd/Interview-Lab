// Display formatting only: values are never recalculated, just shown in the
// user's locale.

const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  'int2',
  'int4',
  'int8',
  'numeric',
  'float4',
  'float8',
]);

const LOCALE = 'pt-BR';
const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const compactNumberFormat = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function isNumericType(type: string): boolean {
  return NUMERIC_TYPES.has(type);
}

export function formatCell(value: unknown, type: string): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (isNumericType(type) && (typeof value === 'number' || typeof value === 'string')) {
    const number = Number(value);
    return Number.isFinite(number) ? numberFormat.format(number) : String(value);
  }
  // timestamptz arrives as ISO 8601 in UTC; it is shown in the user's time zone.
  if (type === 'timestamptz' && typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : dateTimeFormat.format(date);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

// Short form for chart axes: 45000000 becomes "45 mi".
export function formatAxisNumber(value: number): string {
  return compactNumberFormat.format(value);
}

// Chart axes need numbers; a value that is not a number is left out of the chart.
export function toChartNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const secondsFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const elapsedFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const percentFormat = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

export function formatInteger(value: number): string {
  return integerFormat.format(value);
}

// Share of a total, for chart labels: 0.465 becomes "46,5%".
export function formatShare(fraction: number): string {
  return percentFormat.format(fraction);
}

// "3 linhas", "1 linha".
export function formatRowCount(count: number): string {
  return `${formatInteger(count)} ${count === 1 ? 'linha' : 'linhas'}`;
}

// Time a query took, as reported by the server: 1840 becomes "1,84 s".
export function formatDuration(milliseconds: number): string {
  return `${secondsFormat.format(milliseconds / MILLISECONDS_PER_SECOND)} s`;
}

// Running clock of a query in progress: 2400 becomes "2,4 s".
export function formatElapsed(milliseconds: number): string {
  return `${elapsedFormat.format(milliseconds / MILLISECONDS_PER_SECOND)} s`;
}

// Hour and minute of an ISO 8601 instant, in the user's time zone.
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date);
}

// Countdown: mm:ss, or h:mm:ss from one hour on.
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const pad = (value: number) => String(value).padStart(2, '0');
  const tail = `${pad(minutes)}:${pad(seconds % SECONDS_PER_MINUTE)}`;
  return hours > 0 ? `${String(hours)}:${tail}` : tail;
}

const currencyFormat = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'BRL' });
const compactCurrencyFormat = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const oneDecimalFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const dayFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeZone: 'UTC' });
const shortDayFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});

const MINUS = '−';

export function formatCurrency(value: number): string {
  return currencyFormat.format(value);
}

// Short form for big amounts: 43800000 becomes "R$ 43,8 mi".
export function formatCompactCurrency(value: number): string {
  return compactCurrencyFormat.format(value);
}

export function formatDecimal(value: number): string {
  return oneDecimalFormat.format(value);
}

// A change with its sign: "+1,8", "−1,8", "0,0". The unit is added by the caller.
export function formatSigned(value: number, decimals: 0 | 1 = 1): string {
  const magnitude =
    decimals === 0 ? formatInteger(Math.abs(value)) : formatDecimal(Math.abs(value));
  if (value > 0) {
    return `+${magnitude}`;
  }
  return value < 0 ? `${MINUS}${magnitude}` : magnitude;
}

// A calendar day sent by the API (YYYY-MM-DD) as dd/mm/aaaa. The day has no
// time zone: it is shown exactly as it came.
export function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? day : dayFormat.format(date);
}

// dd/mm, for chart axes.
export function formatShortDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? day : shortDayFormat.format(date);
}

// Date and time of an ISO 8601 instant, in the user's time zone.
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
}
