import type { QueryResult } from '@interview-lab/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResultTable } from './ResultTable';

const RESULT: QueryResult = {
  columns: [
    { name: 'regiao', type: 'text' },
    { name: 'faturamento', type: 'numeric' },
    { name: 'regiao', type: 'text' },
  ],
  rows: [
    ['Sul', '2097461.75', 'S'],
    ['Norte', null, 'N'],
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 4,
};

describe('ResultTable', () => {
  it('shows one header per column, including repeated names', () => {
    render(<ResultTable result={RESULT} />);

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'regiao',
      'faturamento',
      'regiao',
    ]);
  });

  it('shows the rows with values formatted for display', () => {
    render(<ResultTable result={RESULT} />);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Sul', '2.097.461,75', 'S']);
    expect(within(rows[1] as HTMLElement).getAllByRole('cell')[1]).toHaveTextContent('—');
  });

  it('says so when there are no rows', () => {
    render(<ResultTable result={{ ...RESULT, rows: [], rowCount: 0 }} />);

    expect(screen.getByText('A consulta não retornou nenhuma linha.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders text from the database as text, never as HTML', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <ResultTable result={{ ...RESULT, rows: [[hostile, '1', 'x']], rowCount: 1 }} />,
    );

    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
