import {
  STOCK_ALERT_STATUSES,
  STOCK_MOVEMENT_TYPES,
  type DashboardPeriod,
  type DashboardRange,
  type StockAlertStatus,
  type StockMovementType,
} from '@interview-lab/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DashboardService,
  type DashboardFilters,
  type DashboardPeriodChoice,
} from '../../api/modules/dashboard.service';
import { KpiCard } from '../../components/KpiCard';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { MessageSquareIcon } from '../../components/ui/icons';
import { Spinner } from '../../components/ui/Spinner';
import { useApiData } from '../../hooks/useApiData';
import { useMoney } from '../../hooks/useMoneyVisibility';
import { CHAT_PATH, type ChatLocationState } from '../../routes';
import { formatDateTime, formatDay, formatDecimal, formatInteger } from '../../utils/format';
import { RegionBars, StockByCenterBars, TopProductsList } from './bars';
import { AbcChart, RevenueChart, type RevenueMode } from './charts';
import { Chips, DashboardCard, Segmented } from './DashboardCard';
import { FilterBar } from './FilterBar';
import { kpiCards } from './kpi-cards';
import {
  ALERT_STATUS_LABELS,
  MOVEMENT_TYPE_COLORS,
  MOVEMENT_TYPE_LABELS,
  rangeLabel,
} from './labels';
import { MovementsTable, StockAlertsTable } from './tables';

const ALL = 'all';
type AlertFilter = StockAlertStatus | typeof ALL;
type MovementFilter = StockMovementType | typeof ALL;
const ALERT_FILTERS: AlertFilter[] = [ALL, ...STOCK_ALERT_STATUSES];
const MOVEMENT_FILTERS: MovementFilter[] = [ALL, ...STOCK_MOVEMENT_TYPES];

const ALERT_DOTS: Record<AlertFilter, string> = {
  all: 'var(--text-3)',
  critical: 'var(--crit)',
  attention: 'var(--warn)',
  ok: 'var(--ok)',
};

const REVENUE_MODES: { value: RevenueMode; label: string }[] = [
  { value: 'daily', label: 'Diário' },
  { value: 'cumulative', label: 'Acumulado' },
];

// The operations dashboard: what was sold, what is in stock and what needs
// attention, for the period and filters chosen. It shows what the server
// computed; nothing here adds up or classifies business data.
export function DashboardPage() {
  const navigate = useNavigate();
  const money = useMoney();
  const [choice, setChoice] = useState<DashboardPeriodChoice>({ period: 'month' });
  const [filters, setFilters] = useState<DashboardFilters>({});
  const [revenueMode, setRevenueMode] = useState<RevenueMode>('daily');
  const [alertFilter, setAlertFilter] = useState<AlertFilter>(ALL);
  const [movementFilter, setMovementFilter] = useState<MovementFilter>(ALL);

  const filtersKey = JSON.stringify(filters);
  const options = useApiData('filters', (signal) => DashboardService.filterOptions(signal));
  const overview = useApiData(`overview:${JSON.stringify(choice)}:${filtersKey}`, (signal) =>
    DashboardService.overview(choice, filters, signal),
  );
  const alerts = useApiData(`alerts:${filtersKey}:${alertFilter}`, (signal) =>
    DashboardService.stockAlerts(filters, alertFilter === ALL ? undefined : alertFilter, signal),
  );
  const movements = useApiData(`movements:${filtersKey}:${movementFilter}`, (signal) =>
    DashboardService.stockMovements(
      filters,
      movementFilter === ALL ? undefined : movementFilter,
      signal,
    ),
  );

  const data = overview.data;
  const period = data ? rangeLabel(data.range) : '';

  function changePeriod(next: Exclude<DashboardPeriod, 'custom'> | DashboardRange) {
    setChoice(typeof next === 'string' ? { period: next } : { period: 'custom', custom: next });
  }

  // Takes the user to the chat with the question written, for them to send
  // (the floating chat of Phase 09d replaces this).
  function ask(label: string, question: string) {
    const state: ChatLocationState = { question: `${question} (Contexto: ${label})` };
    void navigate(CHAT_PATH, { state });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 px-6 pt-[18px]">
        <div className="min-w-[280px] flex-1">
          <h1 className="text-xl font-semibold tracking-[-0.015em]">Operações e vendas</h1>
          <p className="mt-[3px] text-[12.5px] text-text-3">
            {data ? `Dados até ${formatDateTime(data.dataUntil)}` : 'Carregando dados…'}
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-[12.5px] text-text-2">
          <span
            aria-hidden="true"
            className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[5px] bg-accent-soft text-accent-text"
          >
            <MessageSquareIcon size={12} strokeWidth={1.7} />
          </span>
          Use em qualquer card para perguntar ao chat com o contexto preenchido
        </p>
      </div>

      <FilterBar
        period={choice.period}
        range={data?.range}
        previousRange={data?.previousRange}
        filters={filters}
        options={options.data}
        onPeriodChange={changePeriod}
        onFiltersChange={setFilters}
      />

      <main
        aria-busy={overview.isLoading}
        className={`flex flex-col gap-4 px-6 pt-4 pb-24 ${
          overview.isLoading && data ? 'opacity-60 transition-opacity' : ''
        }`}
      >
        {overview.error !== undefined && <ErrorMessage message={overview.error} />}
        {options.error !== undefined && <ErrorMessage message={options.error} />}
        {!data && overview.error === undefined && <Spinner label="Carregando o dashboard…" />}

        {data && (
          <>
            <section
              aria-label="Indicadores"
              className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3"
            >
              {kpiCards(data.kpis, money).map((card) => (
                <KpiCard
                  key={card.key}
                  label={card.label}
                  value={card.value}
                  delta={card.delta}
                  trend={card.trend}
                  sentiment={card.sentiment}
                  compareLabel="vs. anterior"
                  sub={card.sub}
                  spark={card.spark}
                  onAsk={() => {
                    ask(`${card.label} · ${period}`, card.question);
                  }}
                />
              ))}
            </section>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,370px),1fr))] gap-3">
              <DashboardCard
                title="Faturamento ao longo do tempo"
                subtitle={
                  revenueMode === 'daily'
                    ? `Diário · ${period} comparado ao período anterior`
                    : `Acumulado · ${period} comparado ao período anterior`
                }
                askLabel="Perguntar sobre isto"
                onAsk={() => {
                  ask(
                    `Faturamento diário · ${period}`,
                    'Como o faturamento evoluiu dia a dia no período?',
                  );
                }}
                className="md:col-span-2"
                actions={
                  <>
                    <p className="flex items-center gap-3 self-center text-xs text-text-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="h-0.5 w-3.5 bg-accent" />
                        Período
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="w-3.5 border-t-2 border-dashed border-text-3"
                        />
                        Anterior
                      </span>
                    </p>
                    <Segmented
                      label="Como mostrar o faturamento"
                      options={REVENUE_MODES}
                      value={revenueMode}
                      onChange={setRevenueMode}
                    />
                  </>
                }
              >
                <RevenueChart series={data.revenueSeries} mode={revenueMode} />
              </DashboardCard>

              <DashboardCard
                title="Faturamento por região"
                subtitle={`${period} · variação vs. período anterior`}
                onAsk={() => {
                  ask(
                    `Faturamento por região · ${period}`,
                    'Qual foi o faturamento por região no período?',
                  );
                }}
              >
                <RegionBars regions={data.revenueByRegion} />
              </DashboardCard>

              <DashboardCard
                title="Top 10 materiais por faturamento"
                subtitle={
                  data.topProducts.sharePercent === null
                    ? period
                    : `${period} · ${formatDecimal(data.topProducts.sharePercent)}% do faturamento total`
                }
                onAsk={() => {
                  ask(
                    `Top 10 materiais · ${period}`,
                    'Quais são os 10 materiais com maior faturamento no período?',
                  );
                }}
              >
                <TopProductsList top={data.topProducts} categories={data.categories} />
              </DashboardCard>

              <DashboardCard
                title="Estoque por centro de distribuição"
                subtitle={`Valor a custo por categoria · ${formatDay(data.range.to)}`}
                onAsk={() => {
                  ask(
                    'Estoque por CD',
                    'Qual é o valor em estoque de cada centro de distribuição, por categoria?',
                  );
                }}
              >
                <StockByCenterBars centers={data.stockByCenter} categories={data.categories} />
              </DashboardCard>

              <DashboardCard
                title="Curva ABC dos materiais"
                subtitle={`${formatInteger(data.abc.activeProducts)} SKUs ativos · faturamento acumulado em 12 meses`}
                onAsk={() => {
                  ask(
                    'Curva ABC · 12 meses',
                    'Quais materiais concentram a maior parte do faturamento dos últimos 12 meses?',
                  );
                }}
              >
                <AbcChart abc={data.abc} />
              </DashboardCard>
            </div>
          </>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,560px),1fr))] gap-3">
          <DashboardCard
            flush
            title="Alertas de ruptura"
            subtitle="Cobertura calculada pela saída média dos últimos 30 dias"
            onAsk={() => {
              ask('Alertas de ruptura', 'Quais materiais estão abaixo do estoque mínimo?');
            }}
          >
            <Chips
              label="Status dos alertas"
              value={alertFilter}
              onChange={setAlertFilter}
              options={ALERT_FILTERS.map((status) => ({
                value: status,
                label: status === ALL ? 'Todos' : ALERT_STATUS_LABELS[status],
                color: ALERT_DOTS[status],
                count: alerts.data?.counts[status],
              }))}
            />
            {alerts.error !== undefined && (
              <div className="px-4 pb-3">
                <ErrorMessage message={alerts.error} />
              </div>
            )}
            {alerts.data && (
              <>
                <StockAlertsTable alerts={alerts.data.items} />
                <p className="mt-auto px-4 py-[9px] text-xs text-text-3">
                  Mostrando {formatInteger(alerts.data.items.length)} de{' '}
                  {formatInteger(alerts.data.counts[alertFilter])} alertas.
                </p>
              </>
            )}
          </DashboardCard>

          <DashboardCard
            flush
            title="Últimas movimentações de estoque"
            subtitle="Todas as movimentações registradas nos CDs"
            onAsk={() => {
              ask(
                'Movimentações de estoque',
                'Quais foram as movimentações de estoque dos últimos 7 dias, por tipo?',
              );
            }}
          >
            <Chips
              label="Tipo de movimentação"
              dot="square"
              value={movementFilter}
              onChange={setMovementFilter}
              options={MOVEMENT_FILTERS.map((type) => ({
                value: type,
                label: type === ALL ? 'Todas' : MOVEMENT_TYPE_LABELS[type],
                color: type === ALL ? 'var(--text-3)' : MOVEMENT_TYPE_COLORS[type],
              }))}
            />
            {movements.error !== undefined && (
              <div className="px-4 pb-3">
                <ErrorMessage message={movements.error} />
              </div>
            )}
            {movements.data && (
              <>
                <MovementsTable movements={movements.data.items} />
                <p className="mt-auto px-4 py-[9px] text-xs text-text-3">
                  {formatInteger(movements.data.items.length)} movimentações mais recentes.
                </p>
              </>
            )}
          </DashboardCard>
        </div>
      </main>
    </div>
  );
}
