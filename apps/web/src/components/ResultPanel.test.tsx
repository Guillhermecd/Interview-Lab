import type { QueryResult } from '@interview-lab/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ResultPanel } from './ResultPanel';

const RESULT: QueryResult = {
  columns: [
    { name: 'regiao', type: 'text' },
    { name: 'faturamento', type: 'numeric' },
  ],
  rows: [
    ['Sul', '1200.50'],
    ['Norte', '800'],
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 4,
};

const MANY_ROWS: QueryResult = {
  ...RESULT,
  rows: Array.from({ length: 9 }, (_item, index) => [`Região ${String(index + 1)}`, '10']),
  rowCount: 9,
};

const BAR = { type: 'bar', xColumn: 'regiao', yColumn: 'faturamento' } as const;

describe('ResultPanel', () => {
  it('opens on the table, with the row count', () => {
    render(<ResultPanel result={RESULT} visualization={BAR} />);

    expect(screen.getByRole('tab', { name: 'Tabela' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('table')).toHaveTextContent('1.200,5');
    expect(screen.getByRole('region', { name: 'Resultado' })).toHaveTextContent('2 linhas');
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('offers no chart when the suggestion is a table', () => {
    render(<ResultPanel result={RESULT} visualization={{ type: 'table' }} />);

    expect(screen.queryByRole('tab', { name: 'Gráfico' })).not.toBeInTheDocument();
  });

  it('shows the suggested chart and lets the user switch the type', async () => {
    const user = userEvent.setup();
    render(<ResultPanel result={RESULT} visualization={BAR} />);

    await user.click(screen.getByRole('tab', { name: 'Gráfico' }));

    expect(screen.getByText('Sugerido: Barras')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Barras' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('figure', { name: 'Gráfico de barras: faturamento por regiao' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Linha' }));
    expect(
      screen.getByRole('figure', { name: 'Gráfico de linha: faturamento por regiao' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rosca' }));
    const donut = screen.getByRole('figure', { name: 'Gráfico de rosca: faturamento por regiao' });
    // The legend lists each slice with its part of what is drawn.
    expect(donut).toHaveTextContent('Sul');
    expect(donut).toHaveTextContent('60,0%');
    // The suggestion of the server is still shown after the user switches.
    expect(screen.getByText('Sugerido: Barras')).toBeInTheDocument();
  });

  it('shows the first rows and all of them on request', async () => {
    const user = userEvent.setup();
    render(<ResultPanel result={MANY_ROWS} visualization={{ type: 'table' }} />);

    expect(screen.getAllByRole('row')).toHaveLength(7);
    expect(screen.getByText(/Mostrando 6 de 9 linhas\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ver todas' }));

    expect(screen.getAllByRole('row')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Ver menos' })).toBeInTheDocument();
  });

  it('warns when the query had more rows than the limit', () => {
    render(<ResultPanel result={{ ...RESULT, truncated: true }} visualization={BAR} />);

    expect(
      screen.getByText('Mostrando as primeiras 2 linhas; a consulta tinha mais.'),
    ).toBeInTheDocument();
  });
});
