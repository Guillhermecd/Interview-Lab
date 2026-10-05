import type { QueryResult } from '@interview-lab/shared';

const NEEDS_QUOTES = /[",;\r\n]/;
// A leading =, +, - or @ makes spreadsheet programs run the cell as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;
// PostgreSQL sends numeric and bigint values as text: "-19.0" is a number.
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
        ? String(value)
        : JSON.stringify(value);
  // Text coming from the database is data, never a formula.
  const isFormula = typeof value === 'string' && FORMULA_START.test(raw) && !PLAIN_NUMBER.test(raw);
  const text = isFormula ? `'${raw}` : raw;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// The result exactly as received, as CSV text (raw values, comma separated).
export function toCsv(result: QueryResult): string {
  const header = result.columns.map((column) => csvCell(column.name)).join(',');
  const rows = result.rows.map((row) =>
    result.columns.map((_column, index) => csvCell(row[index])).join(','),
  );
  return [header, ...rows].join('\r\n');
}

// Hands the text to the browser as a file to save.
export function downloadCsv(fileName: string, csv: string): void {
  // The BOM makes spreadsheet programs read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
