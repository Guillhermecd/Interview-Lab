import type { QueryResult } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

function resultOf(columns: string[], rows: unknown[][]): QueryResult {
  return {
    columns: columns.map((name) => ({ name, type: 'text' })),
    rows,
    rowCount: rows.length,
    truncated: false,
    durationMs: 1,
  };
}

describe('toCsv', () => {
  it('writes the header and one line per row, with the raw values', () => {
    const csv = toCsv(
      resultOf(
        ['regiao', 'faturamento'],
        [
          ['Sul', '1200.50'],
          ['Norte', 800],
        ],
      ),
    );

    expect(csv).toBe('regiao,faturamento\r\nSul,1200.50\r\nNorte,800');
  });

  it('quotes values with separators, quotes or line breaks', () => {
    const csv = toCsv(resultOf(['nome'], [['Silva, João'], ['disse "oi"'], ['linha 1\nlinha 2']]));

    expect(csv).toBe('nome\r\n"Silva, João"\r\n"disse ""oi"""\r\n"linha 1\nlinha 2"');
  });

  it('leaves empty what has no value and writes objects as JSON', () => {
    const csv = toCsv(resultOf(['a', 'b', 'c'], [[null, undefined, { x: 1 }]]));

    expect(csv).toBe('a,b,c\r\n,,"{""x"":1}"');
  });

  it('keeps text from the database from being read as a formula', () => {
    const csv = toCsv(resultOf(['nome'], [['=HYPERLINK("http://x")'], ['+55 11'], ['@user']]));

    expect(csv).toBe(`nome\r\n"'=HYPERLINK(""http://x"")"\r\n'+55 11\r\n'@user`);
  });

  it('does not touch numbers that start with a minus sign', () => {
    expect(toCsv(resultOf(['variacao'], [[-19.5]]))).toBe('variacao\r\n-19.5');
  });
});
