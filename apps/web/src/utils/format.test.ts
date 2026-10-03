import { describe, expect, it } from 'vitest';
import { formatCell, toChartNumber } from './format';

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
