import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILTER_OPTIONS,
  OVERVIEW,
  STOCK_ALERTS,
  stubDashboard,
} from '../../test/dashboard-fixtures';
import { FakeApi, jsonResponse } from '../../test/fake-api';
import { DashboardPage } from './DashboardPage';

let api: FakeApi;

beforeEach(() => {
  api = stubDashboard(new FakeApi());
  vi.stubGlobal('fetch', api.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Stands for the chat: shows what the dashboard handed over.
function ChatStub() {
  const state = useLocation().state as { question?: string } | null;
  return <p>Chat: {state?.question}</p>;
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/chat" element={<ChatStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

function requests(resource: string): string[] {
  return api.calls
    .map((call) => call.key)
    .filter((key) => key.startsWith(`GET /api/dashboard/${resource}`));
}

describe('DashboardPage', () => {
  it('shows the six indicators as the server computed them', async () => {
    renderDashboard();

    const indicators = await screen.findByRole('region', { name: 'Indicadores' });
    const cards = within(indicators).getAllByRole('article');
    expect(cards.map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Faturamento do período',
      'Pedidos de venda',
      'Valor total em estoque',
      'Giro de estoque',
      'Itens abaixo do estoque mínimo',
      'Pedidos entregues no prazo',
    ]);
    expect(cards[0]).toHaveTextContent('R$ 43,8 mi');
    expect(cards[0]).toHaveTextContent('−1,8%');
    expect(cards[0]).toHaveTextContent('Período anterior: R$ 44,62 mi');
    expect(cards[1]).toHaveTextContent('Ticket médio R$ 18.372,40 (+0,1%)');
    expect(cards[3]).toHaveTextContent('36 dias');
    expect(cards[3]).toHaveTextContent('+3 dias');
    expect(cards[4]).toHaveTextContent('12 críticos · 35 em atenção');
    expect(cards[5]).toHaveTextContent('Meta 95% · 2.203 de 2.384');
  });

  it('colors a variation by what the server said it means', async () => {
    renderDashboard();
    await screen.findByRole('region', { name: 'Indicadores' });

    // More days of stock is bad news; a bigger stock value is neither.
    expect(screen.getByText('+3 dias')).toHaveAttribute('data-sentiment', 'bad');
    expect(screen.getByText('+2,6%')).toHaveAttribute('data-sentiment', 'neutral');
  });

  it('shows the period and the one it is compared with, as resolved by the server', async () => {
    renderDashboard();

    const filters = await screen.findByRole('search', { name: 'Filtros do dashboard' });
    await waitFor(() => {
      expect(filters).toHaveTextContent('01/09/2026 – 30/09/2026');
    });
    expect(filters).toHaveTextContent('vs. 02/08/2026 – 31/08/2026');
    expect(within(filters).getByRole('button', { name: 'Mês' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows charts, rankings and the ABC classes', async () => {
    renderDashboard();

    expect(
      await screen.findByRole('figure', { name: /Faturamento diário do período/ }),
    ).toBeInTheDocument();
    const regions = screen.getByRole('region', { name: 'Faturamento por região' });
    expect(regions).toHaveTextContent('Sudeste');
    expect(regions).toHaveTextContent('−7,5%');
    expect(regions).toHaveTextContent('+3,1%');
    const top = screen.getByRole('region', { name: 'Top 10 materiais por faturamento' });
    expect(top).toHaveTextContent('41,3% do faturamento total');
    expect(within(top).getAllByRole('listitem')).toHaveLength(2);
    const abc = screen.getByRole('region', { name: 'Curva ABC dos materiais' });
    expect(abc).toHaveTextContent('200 SKUs ativos');
    expect(abc).toHaveTextContent('Classe A · 45 SKUs');
    expect(abc).toHaveTextContent('80,0%');
    expect(
      screen.getByRole('region', { name: 'Estoque por centro de distribuição' }),
    ).toHaveTextContent('CD Campinas');
  });

  it('switches the revenue chart between daily and cumulative', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('figure', { name: /Faturamento diário/ });

    await user.click(screen.getByRole('button', { name: 'Acumulado' }));

    expect(screen.getByRole('figure', { name: /Faturamento acumulado/ })).toBeInTheDocument();
  });

  it('lists the stock alerts with their status and counts', async () => {
    renderDashboard();

    const alerts = await screen.findByRole('region', { name: 'Alertas de ruptura' });
    const rows = await within(alerts).findAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Vergalhão CA-50 10 mm');
    expect(rows[1]).toHaveTextContent('1.240 br');
    expect(rows[1]).toHaveTextContent('2 d');
    expect(rows[1]).toHaveTextContent('Crítico');
    // No outflow to measure coverage with.
    expect(within(rows[2] as HTMLElement).getAllByRole('cell')[4]).toHaveTextContent('—');
    expect(within(alerts).getByRole('button', { name: /Crítico/ })).toHaveTextContent('12');
    expect(alerts).toHaveTextContent('Mostrando 2 de 56 alertas.');
  });

  it('asks the server for one status when a chip is chosen', async () => {
    const user = userEvent.setup();
    renderDashboard();
    const alerts = await screen.findByRole('region', { name: 'Alertas de ruptura' });
    await within(alerts).findAllByRole('row');

    await user.click(within(alerts).getByRole('button', { name: /Atenção/ }));

    await waitFor(() => {
      expect(requests('stock-alerts')).toContain(
        'GET /api/dashboard/stock-alerts?status=attention',
      );
    });
    await waitFor(() => {
      expect(alerts).toHaveTextContent('Mostrando 2 de 35 alertas.');
    });
  });

  it('shows each kind of movement with its sign and where a transfer went', async () => {
    renderDashboard();

    const movements = await screen.findByRole('region', {
      name: 'Últimas movimentações de estoque',
    });
    const rows = await within(movements).findAllByRole('row');
    expect(rows[1]).toHaveTextContent('Saída');
    expect(rows[1]).toHaveTextContent('−1.200 sc');
    expect(rows[2]).toHaveTextContent('+2.400 br');
    expect(rows[3]).toHaveTextContent('CD Campinas → CD Curitiba');
    expect(rows[3]).toHaveTextContent('300 rl');
    expect(rows[4]).toHaveTextContent('−36 pr');
    expect(rows[4]).toHaveTextContent('Inventário cíclico');
  });

  it('sends the chosen period to the server', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('region', { name: 'Indicadores' });
    expect(requests('overview')).toEqual(['GET /api/dashboard/overview?period=month']);

    await user.click(screen.getByRole('button', { name: '7 dias' }));

    await waitFor(() => {
      expect(requests('overview')).toContain('GET /api/dashboard/overview?period=7d');
    });
  });

  it('sends a custom range only when the user applies it', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('region', { name: 'Indicadores' });

    await user.click(screen.getByRole('button', { name: 'Personalizado' }));
    const dialog = screen.getByRole('dialog', { name: 'Intervalo personalizado' });
    // It starts from the days on screen.
    expect(within(dialog).getByLabelText('De')).toHaveValue('2026-09-01');
    expect(requests('overview')).toHaveLength(1);

    await user.clear(within(dialog).getByLabelText('De'));
    await user.type(within(dialog).getByLabelText('De'), '2026-09-10');
    await user.clear(within(dialog).getByLabelText('Até'));
    await user.type(within(dialog).getByLabelText('Até'), '2026-09-20');
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => {
      expect(requests('overview')).toContain(
        'GET /api/dashboard/overview?period=custom&from=2026-09-10&to=2026-09-20',
      );
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not apply a range that ends before it starts', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('region', { name: 'Indicadores' });
    await user.click(screen.getByRole('button', { name: 'Personalizado' }));
    const dialog = screen.getByRole('dialog', { name: 'Intervalo personalizado' });

    await user.clear(within(dialog).getByLabelText('Até'));
    await user.type(within(dialog).getByLabelText('Até'), '2026-08-01');

    expect(within(dialog).getByRole('button', { name: 'Aplicar' })).toBeDisabled();
  });

  it('sends the filters to every part of the dashboard, and clears them', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('region', { name: 'Indicadores' });
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Centro de distribuição/ }));
    await user.click(screen.getByRole('option', { name: 'CD Curitiba' }));
    await user.click(screen.getByRole('button', { name: /Categoria/ }));
    await user.click(screen.getByRole('option', { name: 'Aço e metais' }));

    const query = 'distributionCenterId=2&category=A%C3%A7o+e+metais';
    await waitFor(() => {
      expect(requests('overview')).toContain(`GET /api/dashboard/overview?period=month&${query}`);
    });
    expect(requests('stock-alerts')).toContain(`GET /api/dashboard/stock-alerts?${query}`);
    expect(requests('stock-movements')).toContain(`GET /api/dashboard/stock-movements?${query}`);
    expect(screen.getByRole('button', { name: /Centro de distribuição/ })).toHaveTextContent(
      'CD Curitiba',
    );

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    expect(screen.getByRole('button', { name: /Centro de distribuição/ })).toHaveTextContent(
      'Todos',
    );
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument();
  });

  it('closes a filter menu with Escape without choosing anything', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('region', { name: 'Indicadores' });

    await user.click(screen.getByRole('button', { name: /Região/ }));
    expect(screen.getByRole('listbox', { name: 'Região' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(requests('overview')).toHaveLength(1);
  });

  it('takes a question about a card to the chat, with the context', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('region', { name: 'Indicadores' });

    await user.click(
      screen.getByRole('button', { name: 'Perguntar sobre isto: Faturamento do período' }),
    );

    expect(
      await screen.findByText(
        'Chat: Por que o faturamento mudou em relação ao período anterior? (Contexto: Faturamento do período · 01/09/2026 – 30/09/2026)',
      ),
    ).toBeInTheDocument();
  });

  it('shows the error when the overview cannot be loaded, keeping the tables', async () => {
    api.on('GET /api/dashboard/overview', () =>
      jsonResponse({ code: 'QUERY_TIMEOUT', message: 'A consulta excedeu o tempo limite.' }, 504),
    );

    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A consulta excedeu o tempo limite.',
    );
    expect(screen.queryByRole('region', { name: 'Indicadores' })).not.toBeInTheDocument();
    expect(
      await within(screen.getByRole('region', { name: 'Alertas de ruptura' })).findAllByRole('row'),
    ).toHaveLength(STOCK_ALERTS.items.length + 1);
  });

  it('says so when there is nothing to show for the filters', async () => {
    api
      .on('GET /api/dashboard/overview', () =>
        jsonResponse({
          ...OVERVIEW,
          revenueByRegion: [],
          topProducts: { items: [], sharePercent: null },
          stockByCenter: [],
        }),
      )
      .on('GET /api/dashboard/stock-alerts', () =>
        jsonResponse({ counts: { all: 0, critical: 0, attention: 0, ok: 0 }, items: [] }),
      )
      .on('GET /api/dashboard/stock-movements', () => jsonResponse({ items: [] }));

    renderDashboard();

    expect(await screen.findByText('Nenhuma venda no período.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma região para os filtros escolhidos.')).toBeInTheDocument();
    expect(
      await screen.findByText('Nenhum alerta para os filtros escolhidos.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Nenhuma movimentação para os filtros escolhidos.'),
    ).toBeInTheDocument();
  });

  it('offers the options the server lists for each filter', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByRole('region', { name: 'Indicadores' });

    await user.click(screen.getByRole('button', { name: /Região/ }));

    expect(
      within(screen.getByRole('listbox', { name: 'Região' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Todas', ...FILTER_OPTIONS.regions.map((region) => region.name)]);
  });
});
