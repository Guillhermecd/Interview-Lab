import type { StockAlert, StockMovement } from '@interview-lab/shared';
import { formatInteger, formatSigned, formatTime } from '../../utils/format';
import {
  ALERT_STATUS_CLASSES,
  ALERT_STATUS_LABELS,
  MOVEMENT_TYPE_COLORS,
  MOVEMENT_TYPE_LABELS,
} from './labels';

const FULL_PERCENT = 100;
const HEAD_CLASS =
  'border-y border-line bg-surface-2 py-[7px] text-[11.5px] font-medium whitespace-nowrap text-text-3';
const dayFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

function EmptyRow({ columns, children }: { columns: number; children: string }) {
  return (
    <tr>
      <td colSpan={columns} className="px-4 py-6 text-center text-[13px] text-text-2">
        {children}
      </td>
    </tr>
  );
}

// Products below or near their minimum stock. The small bar shows how much of
// the minimum is in stock: only how the two numbers of the row are drawn.
export function StockAlertsTable({ alerts }: { alerts: StockAlert[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th scope="col" className={`${HEAD_CLASS} w-[34%] pl-4 text-left`}>
              Material
            </th>
            <th scope="col" className={`${HEAD_CLASS} text-left`}>
              Centro de distribuição
            </th>
            <th scope="col" className={`${HEAD_CLASS} text-right`}>
              Estoque atual
            </th>
            <th scope="col" className={`${HEAD_CLASS} text-right`}>
              Mínimo
            </th>
            <th scope="col" className={`${HEAD_CLASS} text-right`}>
              Cobertura
            </th>
            <th scope="col" className={`${HEAD_CLASS} pr-4 pl-3.5 text-left`}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {alerts.length === 0 && (
            <EmptyRow columns={6}>Nenhum alerta para os filtros escolhidos.</EmptyRow>
          )}
          {alerts.map((alert) => {
            const status = ALERT_STATUS_CLASSES[alert.status];
            const share =
              alert.minimumQuantity <= 0
                ? FULL_PERCENT
                : Math.min(FULL_PERCENT, (alert.quantity / alert.minimumQuantity) * FULL_PERCENT);
            return (
              <tr
                key={`${alert.productId}-${alert.distributionCenterId}`}
                className="border-b border-line hover:bg-surface-2"
              >
                <td className="max-w-0 truncate py-2 pr-2 pl-4" title={alert.product}>
                  {alert.product}
                </td>
                <td className="py-2 whitespace-nowrap text-text-2">{alert.distributionCenter}</td>
                <td className="py-1.5">
                  <div className="flex flex-col items-end gap-[3px]">
                    <span className="font-mono">
                      {formatInteger(alert.quantity)} {alert.unit}
                    </span>
                    <div
                      aria-hidden="true"
                      className="h-[3px] w-16 overflow-hidden rounded-sm bg-surface-3"
                    >
                      <div
                        className={`h-full ${status.fill}`}
                        style={{ width: `${String(share)}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="py-2 text-right font-mono text-text-2">
                  {formatInteger(alert.minimumQuantity)}
                </td>
                <td className={`py-2 text-right font-mono font-semibold ${status.text}`}>
                  {alert.coverageDays === null ? '—' : `${formatInteger(alert.coverageDays)} d`}
                </td>
                <td className="py-2 pr-4 pl-3.5">
                  <span
                    className={`inline-flex h-[22px] items-center gap-[5px] rounded px-2 text-xs font-semibold ${status.soft} ${status.text}`}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                    {ALERT_STATUS_LABELS[alert.status]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// "+2.400 br" for what came in, "−1.200 sc" for what left, the plain amount
// for a transfer, and the sign it was recorded with for an adjustment.
function movementQuantity(movement: StockMovement): string {
  const amount = formatInteger(Math.abs(movement.quantity));
  switch (movement.type) {
    case 'inbound':
      return `+${amount} ${movement.unit}`;
    case 'outbound':
      return `−${amount} ${movement.unit}`;
    case 'transfer':
      return `${amount} ${movement.unit}`;
    case 'adjustment':
      return `${formatSigned(movement.quantity, 0)} ${movement.unit}`;
  }
}

function movementDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dayFormat.format(date);
}

export function MovementsTable({ movements }: { movements: StockMovement[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th scope="col" className={`${HEAD_CLASS} pl-4 text-left`}>
              Data
            </th>
            <th scope="col" className={`${HEAD_CLASS} text-left`}>
              Tipo
            </th>
            <th scope="col" className={`${HEAD_CLASS} w-[28%] text-left`}>
              Material
            </th>
            <th scope="col" className={`${HEAD_CLASS} text-left`}>
              CD
            </th>
            <th scope="col" className={`${HEAD_CLASS} text-right`}>
              Quantidade
            </th>
            <th scope="col" className={`${HEAD_CLASS} pr-4 pl-3.5 text-left`}>
              Responsável
            </th>
          </tr>
        </thead>
        <tbody>
          {movements.length === 0 && (
            <EmptyRow columns={6}>Nenhuma movimentação para os filtros escolhidos.</EmptyRow>
          )}
          {movements.map((movement) => (
            <tr key={movement.id} className="border-b border-line hover:bg-surface-2">
              <td className="py-1.5 pr-2 pl-4 leading-tight whitespace-nowrap">
                <time dateTime={movement.movedAt} className="flex flex-col font-mono">
                  <span className="text-xs">{movementDay(movement.movedAt)}</span>
                  <span className="text-[11px] text-text-3">{formatTime(movement.movedAt)}</span>
                </time>
              </td>
              <td className="py-2 pr-2">
                <span className="inline-flex h-[22px] items-center gap-1.5 rounded bg-surface-3 px-2 text-xs font-medium whitespace-nowrap">
                  <span
                    aria-hidden="true"
                    className="h-[7px] w-[7px] rounded-sm"
                    style={{ backgroundColor: MOVEMENT_TYPE_COLORS[movement.type] }}
                  />
                  {MOVEMENT_TYPE_LABELS[movement.type]}
                </span>
              </td>
              <td className="max-w-0 truncate py-2 pr-2" title={movement.product}>
                {movement.product}
              </td>
              <td className="py-2 pr-2 whitespace-nowrap text-text-2">
                {movement.destinationCenter === undefined
                  ? movement.distributionCenter
                  : `${movement.distributionCenter} → ${movement.destinationCenter}`}
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {movementQuantity(movement)}
              </td>
              <td className="py-1.5 pr-4 pl-3.5 leading-tight">
                <span className="block truncate">{movement.responsibleName}</span>
                <span className="block truncate text-[11px] text-text-3">{movement.document}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
