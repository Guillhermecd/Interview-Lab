import {
  DASHBOARD_PERIODS,
  STOCK_ALERT_STATUSES,
  STOCK_MOVEMENT_TYPES,
  type DashboardPeriod,
  type DashboardRange,
  type StockAlertStatus,
  type StockMovementType,
} from '@interview-lab/shared';
import { ValidationError } from '../http/validation-error.js';
import { daysInRange, isCalendarDay } from './dashboard-period.js';
import type { DashboardFilters } from './dashboard.repository.js';
import type { OverviewRequest } from './dashboard.service.js';

const ID_PATTERN = /^[1-9][0-9]{0,17}$/;
const MAX_CATEGORY_LENGTH = 100;
const DEFAULT_PERIOD: DashboardPeriod = 'month';
// Two years of data exist; a longer custom period would only be slower.
const MAX_CUSTOM_DAYS = 731;
const DEFAULT_LIST_LIMIT = 8;
const MAX_LIST_LIMIT = 100;

function invalid(name: string, message: string): ValidationError {
  return new ValidationError([{ field: name, message }]);
}

// A query parameter given once, as text. Absent or empty means "not given".
function text(query: unknown, name: string): string | undefined {
  const value =
    typeof query === 'object' && query !== null
      ? (query as Record<string, unknown>)[name]
      : undefined;
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw invalid(name, 'Informe um único valor.');
  }
  return value;
}

function readId(query: unknown, name: string): string | undefined {
  const value = text(query, name);
  if (value !== undefined && !ID_PATTERN.test(value)) {
    throw invalid(name, 'Identificador inválido.');
  }
  return value;
}

function readOneOf<Value extends string>(
  query: unknown,
  name: string,
  allowed: readonly Value[],
): Value | undefined {
  const value = text(query, name);
  if (value === undefined) {
    return undefined;
  }
  const known = allowed.find((candidate) => candidate === value);
  if (known === undefined) {
    throw invalid(name, `Valores aceitos: ${allowed.join(', ')}.`);
  }
  return known;
}

export function readFilters(query: unknown): DashboardFilters {
  const category = text(query, 'category');
  if (category !== undefined && category.length > MAX_CATEGORY_LENGTH) {
    throw invalid('category', 'Categoria inválida.');
  }
  return {
    distributionCenterId: readId(query, 'distributionCenterId'),
    regionId: readId(query, 'regionId'),
    category,
  };
}

function readDay(query: unknown, name: string): string {
  const value = text(query, name);
  if (value === undefined || !isCalendarDay(value)) {
    throw invalid(name, 'Informe uma data no formato AAAA-MM-DD.');
  }
  return value;
}

// `today` is the current day of the business: a period cannot end after it.
function readCustomRange(query: unknown, today: string): DashboardRange {
  const range = { from: readDay(query, 'from'), to: readDay(query, 'to') };
  if (range.from > range.to) {
    throw invalid('from', 'A data inicial deve ser anterior ou igual à final.');
  }
  if (range.to > today) {
    throw invalid('to', 'A data final não pode estar no futuro.');
  }
  if (daysInRange(range) > MAX_CUSTOM_DAYS) {
    throw invalid('to', `O período pode ter no máximo ${String(MAX_CUSTOM_DAYS)} dias.`);
  }
  return range;
}

export function readOverviewRequest(query: unknown, today: string): OverviewRequest {
  const period = readOneOf(query, 'period', DASHBOARD_PERIODS) ?? DEFAULT_PERIOD;
  return {
    filters: readFilters(query),
    period,
    custom: period === 'custom' ? readCustomRange(query, today) : undefined,
  };
}

export function readAlertStatus(query: unknown): StockAlertStatus | undefined {
  return readOneOf(query, 'status', STOCK_ALERT_STATUSES);
}

export function readMovementType(query: unknown): StockMovementType | undefined {
  return readOneOf(query, 'type', STOCK_MOVEMENT_TYPES);
}

export function readLimit(query: unknown): number {
  const value = text(query, 'limit');
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw invalid('limit', `Informe um número entre 1 e ${String(MAX_LIST_LIMIT)}.`);
  }
  return limit;
}
