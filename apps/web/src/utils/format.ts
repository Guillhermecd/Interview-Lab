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

// Chart axes need numbers; a value that is not a number is left out of the chart.
export function toChartNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
