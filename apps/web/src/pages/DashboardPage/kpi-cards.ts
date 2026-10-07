import type { DashboardKpis, KpiSentiment, KpiTrend } from '@interview-lab/shared';
import {
  formatDecimal,
  formatInteger,
  formatSigned,
  VISIBLE_MONEY,
  type MoneyFormat,
} from '../../utils/format';

// What one indicator card shows. Every number arrives computed by the server;
// here they only become text.
export interface KpiCardContent {
  key: keyof DashboardKpis;
  label: string;
  value: string;
  delta: string;
  trend: KpiTrend;
  sentiment: KpiSentiment;
  sub: string;
  spark: number[];
  // What "Perguntar sobre isto" writes in the chat.
  question: string;
}

const NO_VALUE = '—';

function text<Value>(value: Value | null, format: (value: Value) => string): string {
  return value === null ? NO_VALUE : format(value);
}

const percent = (value: number) => `${formatSigned(value)}%`;
const plural = (count: number, one: string, many: string) =>
  `${formatInteger(count)} ${count === 1 ? one : many}`;

export function kpiCards(
  kpis: DashboardKpis,
  money: MoneyFormat = VISIBLE_MONEY,
): KpiCardContent[] {
  const { revenue, orders, stockValue, coverageDays, belowMinimum, onTimeDelivery } = kpis;

  return [
    {
      key: 'revenue',
      label: 'Faturamento do período',
      value: text(revenue.value, money.compactCurrency),
      delta: text(revenue.delta, percent),
      trend: revenue.trend,
      sentiment: revenue.sentiment,
      sub: `Período anterior: ${text(revenue.previousValue, money.compactCurrency)}`,
      spark: revenue.spark,
      question: 'Por que o faturamento mudou em relação ao período anterior?',
    },
    {
      key: 'orders',
      label: 'Pedidos de venda',
      value: text(orders.value, formatInteger),
      delta: text(orders.delta, percent),
      trend: orders.trend,
      sentiment: orders.sentiment,
      sub:
        orders.averageTicket === null
          ? 'Sem pedidos no período'
          : `Ticket médio ${money.currency(orders.averageTicket)}${
              orders.averageTicketDeltaPercent === null
                ? ''
                : ` (${percent(orders.averageTicketDeltaPercent)})`
            }`,
      spark: orders.spark,
      question: 'Quais são os 5 clientes com maior volume de compra no período?',
    },
    {
      key: 'stockValue',
      label: 'Valor total em estoque',
      value: text(stockValue.value, money.compactCurrency),
      delta: text(stockValue.delta, percent),
      trend: stockValue.trend,
      sentiment: stockValue.sentiment,
      sub: `${plural(stockValue.distributionCenters, 'CD', 'CDs')} · ${plural(
        stockValue.activeProducts,
        'SKU ativo',
        'SKUs ativos',
      )}`,
      spark: stockValue.spark,
      question: 'Qual é o valor em estoque de cada centro de distribuição?',
    },
    {
      key: 'coverageDays',
      label: 'Giro de estoque',
      value: text(coverageDays.value, (days) => plural(days, 'dia', 'dias')),
      delta: text(coverageDays.delta, (days) => `${formatSigned(days, 0)} dias`),
      trend: coverageDays.trend,
      sentiment: coverageDays.sentiment,
      sub:
        coverageDays.turnsPerYear === null
          ? 'Sem saídas no período'
          : `Cobertura média · giro ${formatDecimal(coverageDays.turnsPerYear)}×/ano`,
      spark: coverageDays.spark,
      question: 'Qual centro de distribuição tem o maior giro de estoque?',
    },
    {
      key: 'belowMinimum',
      label: 'Itens abaixo do estoque mínimo',
      value: text(belowMinimum.value, formatInteger),
      delta: text(belowMinimum.delta, (items) => formatSigned(items, 0)),
      trend: belowMinimum.trend,
      sentiment: belowMinimum.sentiment,
      sub: `${plural(belowMinimum.critical, 'crítico', 'críticos')} · ${formatInteger(
        belowMinimum.attention,
      )} em atenção`,
      spark: belowMinimum.spark,
      question: 'Quais materiais estão abaixo do estoque mínimo?',
    },
    {
      key: 'onTimeDelivery',
      label: 'Pedidos entregues no prazo',
      value: text(onTimeDelivery.value, (share) => `${formatDecimal(share)}%`),
      delta: text(onTimeDelivery.delta, (points) => `${formatSigned(points)} p.p.`),
      trend: onTimeDelivery.trend,
      sentiment: onTimeDelivery.sentiment,
      sub: `Meta ${formatInteger(onTimeDelivery.targetPercent)}% · ${formatInteger(
        onTimeDelivery.onTimeOrders,
      )} de ${formatInteger(onTimeDelivery.deliveredOrders)}`,
      spark: onTimeDelivery.spark,
      question: 'Quais pedidos foram entregues com atraso no período?',
    },
  ];
}
