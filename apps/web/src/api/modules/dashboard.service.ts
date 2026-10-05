import type {
  DashboardFilterOptions,
  DashboardOverview,
  DashboardPeriod,
  DashboardRange,
  StockAlertList,
  StockAlertStatus,
  StockMovementList,
  StockMovementType,
} from '@interview-lab/shared';
import { requestJson } from './api';

const BASE_PATH = '/dashboard';

// What the user narrowed the dashboard to. Absent means "all".
export interface DashboardFilters {
  distributionCenterId?: string | undefined;
  regionId?: string | undefined;
  category?: string | undefined;
}

export interface DashboardPeriodChoice {
  period: DashboardPeriod;
  // Sent only with the custom period.
  custom?: DashboardRange | undefined;
}

function queryString(values: Record<string, string | number | undefined>): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') {
      parameters.set(name, String(value));
    }
  }
  const text = parameters.toString();
  return text === '' ? '' : `?${text}`;
}

// Only transports data: the server computes every number of the dashboard.
export const DashboardService = {
  filterOptions(signal?: AbortSignal): Promise<DashboardFilterOptions> {
    return requestJson<DashboardFilterOptions>(`${BASE_PATH}/filters`, { signal: signal ?? null });
  },

  overview(
    choice: DashboardPeriodChoice,
    filters: DashboardFilters,
    signal?: AbortSignal,
  ): Promise<DashboardOverview> {
    const custom = choice.period === 'custom' ? choice.custom : undefined;
    return requestJson<DashboardOverview>(
      `${BASE_PATH}/overview${queryString({
        period: choice.period,
        from: custom?.from,
        to: custom?.to,
        ...filters,
      })}`,
      { signal: signal ?? null },
    );
  },

  stockAlerts(
    filters: DashboardFilters,
    status: StockAlertStatus | undefined,
    signal?: AbortSignal,
  ): Promise<StockAlertList> {
    return requestJson<StockAlertList>(
      `${BASE_PATH}/stock-alerts${queryString({ ...filters, status })}`,
      { signal: signal ?? null },
    );
  },

  stockMovements(
    filters: DashboardFilters,
    type: StockMovementType | undefined,
    signal?: AbortSignal,
  ): Promise<StockMovementList> {
    return requestJson<StockMovementList>(
      `${BASE_PATH}/stock-movements${queryString({ ...filters, type })}`,
      { signal: signal ?? null },
    );
  },
};
