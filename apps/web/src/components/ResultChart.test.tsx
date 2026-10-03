import type { QueryResult } from '@interview-lab/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResultChart } from './ResultChart';

const SIZE = { width: 600, height: 300 };

const RESULT: QueryResult = {
  columns: [
    { name: 'regiao', type: 'text' },
    { name: 'faturamento', type: 'numeric' },
  ],
  rows: [
    ['Sul', '2097461.75'],
    ['Norte', '2285335.43'],
    ['Sem valor', null],
  ],
  rowCount: 3,
  truncated: false,
  durationMs: 4,
};

describe('ResultChart', () => {
  it('draws a bar chart with the suggested columns', () => {
    const { container } = render(
      <ResultChart
        result={RESULT}
        visualization={{ type: 'bar', xColumn: 'regiao', yColumn: 'faturamento' }}
        size={SIZE}
      />,
    );

    expect(
      screen.getByRole('figure', { name: 'Gráfico de barras: faturamento por regiao' }),
    ).toBeInTheDocument();
    // One bar per row with a numeric value.
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
  });

  it('draws a line chart', () => {
    render(
      <ResultChart
        result={RESULT}
        visualization={{ type: 'line', xColumn: 'regiao', yColumn: 'faturamento' }}
        size={SIZE}
      />,
    );

    expect(
      screen.getByRole('figure', { name: 'Gráfico de linha: faturamento por regiao' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['a table suggestion', { type: 'table' as const }],
    [
      'a column that is not in the result',
      { type: 'bar' as const, xColumn: 'pais', yColumn: 'faturamento' },
    ],
  ])('draws nothing for %s', (_case, visualization) => {
    const { container } = render(
      <ResultChart result={RESULT} visualization={visualization} size={SIZE} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing when no value is numeric', () => {
    const { container } = render(
      <ResultChart
        result={{ ...RESULT, rows: [['Sul', 'n/a']] }}
        visualization={{ type: 'bar', xColumn: 'regiao', yColumn: 'faturamento' }}
        size={SIZE}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
