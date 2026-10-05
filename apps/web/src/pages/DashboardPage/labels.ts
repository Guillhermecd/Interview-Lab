import type {
  DashboardPeriod,
  DashboardRange,
  StockAlertStatus,
  StockMovementType,
} from '@interview-lab/shared';
import { formatDay } from '../../utils/format';

// Texts and colors of the dashboard. Colors are theme tokens.

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  '7d': '7 dias',
  '30d': '30 dias',
  month: 'Mês',
  quarter: 'Trimestre',
  year: 'Ano',
  custom: 'Personalizado',
};

export const ALERT_STATUS_LABELS: Record<StockAlertStatus, string> = {
  critical: 'Crítico',
  attention: 'Atenção',
  ok: 'OK',
};

// Fixed semantics: critical, attention and ok are only ever used for status.
export const ALERT_STATUS_CLASSES: Record<
  StockAlertStatus,
  { text: string; soft: string; fill: string }
> = {
  critical: { text: 'text-crit', soft: 'bg-crit-soft', fill: 'bg-crit' },
  attention: { text: 'text-warn', soft: 'bg-warn-soft', fill: 'bg-warn' },
  ok: { text: 'text-ok', soft: 'bg-ok-soft', fill: 'bg-ok' },
};

export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  inbound: 'Entrada',
  outbound: 'Saída',
  transfer: 'Transferência',
  adjustment: 'Ajuste',
};

export const MOVEMENT_TYPE_COLORS: Record<StockMovementType, string> = {
  inbound: 'var(--c4)',
  outbound: 'var(--c1)',
  transfer: 'var(--c3)',
  adjustment: 'var(--c5)',
};

const CATEGORY_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];

// Categories are colored by their position in the list the server sends.
export function categoryColor(position: number): string {
  return CATEGORY_COLORS[position % CATEGORY_COLORS.length] ?? 'var(--c1)';
}

export function rangeLabel(range: DashboardRange): string {
  return `${formatDay(range.from)} – ${formatDay(range.to)}`;
}
