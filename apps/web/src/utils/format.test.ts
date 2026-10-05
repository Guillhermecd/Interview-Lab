import { describe, expect, it } from 'vitest';
import {
  formatAxisNumber,
  formatCell,
  formatCountdown,
  formatDuration,
  formatElapsed,
  formatInteger,
  formatRowCount,
  formatShare,
  formatTime,
  toChartNumber,
} from './format';

describe('formatCell', () => {
  it.each([
    ['1234567.891', 'numeric', '1.234.567,89'],
    ['20000', 'int8', '20.000'],
    [42, 'int4', '42'],
  ])('formats %s (%s) in the Brazilian locale as %s', (value, type, expected) => {
    expect(formatCell(value, type)).toBe(expected);
  });

  it('shows null as a dash', () => {
    expect(formatCell(null, 'text')).toBe('—');
  });

  it('keeps text and dates without time zone as they came', () => {
    expect(formatCell('Sul', 'text')).toBe('Sul');
    expect(formatCell('2026-09-02', 'date')).toBe('2026-09-02');
  });

  it('shows a timestamptz in the local time zone', () => {
    const formatted = formatCell('2026-06-21T18:00:00.000Z', 'timestamptz');

    expect(formatted).toMatch(/21\/06\/2026/);
  });

  it('keeps an invalid number or date as it came', () => {
    expect(formatCell('abc', 'numeric')).toBe('abc');
    expect(formatCell('not a date', 'timestamptz')).toBe('not a date');
  });

  it('shows booleans and structured values as text', () => {
    expect(formatCell(true, 'bool')).toBe('true');
    expect(formatCell({ a: 1 }, 'unknown')).toBe('{"a":1}');
  });
});

describe('formatAxisNumber', () => {
  it('abbreviates large numbers for chart axes', () => {
    // Intl separates number and unit with a non-breaking space.
    expect(formatAxisNumber(45_000_000).replace(/\s/gu, ' ')).toBe('45 mi');
    expect(formatAxisNumber(1500).replace(/\s/gu, ' ')).toBe('1,5 mil');
    expect(formatAxisNumber(12)).toBe('12');
  });
});

describe('toChartNumber', () => {
  it.each([
    ['12.5', 12.5],
    [7, 7],
    ['abc', null],
    [null, null],
    [true, null],
  ])('turns %s into %s', (value, expected) => {
    expect(toChartNumber(value)).toBe(expected);
  });
});

describe('display helpers of the answer metadata', () => {
  it('formats how long a query took', () => {
    expect(formatDuration(1840)).toBe('1,84 s');
    expect(formatDuration(12)).toBe('0,01 s');
  });

  it('formats the clock of a running query', () => {
    expect(formatElapsed(2400)).toBe('2,4 s');
  });

  it('counts rows in singular and plural', () => {
    expect(formatRowCount(1)).toBe('1 linha');
    expect(formatRowCount(0)).toBe('0 linhas');
    expect(formatRowCount(1200)).toBe('1.200 linhas');
  });

  it('formats a countdown as mm:ss, and h:mm:ss from one hour on', () => {
    expect(formatCountdown(42)).toBe('00:42');
    expect(formatCountdown(125)).toBe('02:05');
    expect(formatCountdown(34_020)).toBe('9:27:00');
    expect(formatCountdown(-3)).toBe('00:00');
  });

  it('formats a share of the total', () => {
    expect(formatShare(0.465)).toBe('46,5%');
  });

  it('formats integers and the time of an instant', () => {
    expect(formatInteger(200_000)).toBe('200.000');
    expect(formatTime('not a date')).toBe('');
    expect(formatTime('2026-10-05T14:32:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });
});
