import { describe, expect, it } from 'vitest';
import { ValidationError } from '../http/validation-error.js';
import {
  readAlertStatus,
  readFilters,
  readLimit,
  readMovementType,
  readOverviewRequest,
} from './dashboard-params.js';

const TODAY = '2026-09-30';

function fieldOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.details[0]?.field;
    }
    throw error;
  }
  return undefined;
}

describe('readFilters', () => {
  it('reads no filter at all', () => {
    expect(readFilters({})).toEqual({
      distributionCenterId: undefined,
      regionId: undefined,
      category: undefined,
    });
    expect(readFilters(undefined)).toEqual(readFilters({}));
  });

  it('treats an empty value as absent', () => {
    expect(readFilters({ distributionCenterId: '', category: '' })).toEqual(readFilters({}));
  });

  it('reads the three filters', () => {
    expect(
      readFilters({ distributionCenterId: '3', regionId: '4', category: 'Aço e metais' }),
    ).toEqual({ distributionCenterId: '3', regionId: '4', category: 'Aço e metais' });
  });

  it.each([
    ['distributionCenterId', { distributionCenterId: '1 OR 1=1' }],
    ['distributionCenterId', { distributionCenterId: '-1' }],
    ['regionId', { regionId: 'abc' }],
    ['regionId', { regionId: ['1', '2'] }],
    ['category', { category: 'x'.repeat(101) }],
  ])('refuses an invalid %s', (field, query) => {
    expect(fieldOf(() => readFilters(query))).toBe(field);
  });

  // The category is free text: it is only ever compared as a parameter.
  it('accepts any short text as a category', () => {
    expect(readFilters({ category: "'; DROP TABLE x; --" }).category).toBe("'; DROP TABLE x; --");
  });
});

describe('readOverviewRequest', () => {
  it('defaults to the current month', () => {
    expect(readOverviewRequest({}, TODAY)).toMatchObject({ period: 'month', custom: undefined });
  });

  it('reads a preset and ignores dates sent with it', () => {
    const request = readOverviewRequest({ period: '7d', from: 'garbage', to: 'garbage' }, TODAY);

    expect(request).toMatchObject({ period: '7d', custom: undefined });
  });

  it('reads a custom range', () => {
    const request = readOverviewRequest(
      { period: 'custom', from: '2026-03-11', to: '2026-03-20' },
      TODAY,
    );

    expect(request.custom).toEqual({ from: '2026-03-11', to: '2026-03-20' });
  });

  it.each([
    ['period', { period: 'decade' }],
    ['from', { period: 'custom', to: '2026-03-20' }],
    ['to', { period: 'custom', from: '2026-03-11', to: '20/03/2026' }],
    ['from', { period: 'custom', from: '2026-03-21', to: '2026-03-20' }],
    ['to', { period: 'custom', from: '2026-09-01', to: '2026-10-01' }],
    ['to', { period: 'custom', from: '2024-01-01', to: '2026-09-30' }],
  ])('refuses an invalid %s', (field, query) => {
    expect(fieldOf(() => readOverviewRequest(query, TODAY))).toBe(field);
  });

  it('accepts a custom range that ends today', () => {
    expect(readOverviewRequest({ period: 'custom', from: TODAY, to: TODAY }, TODAY).custom).toEqual(
      { from: TODAY, to: TODAY },
    );
  });
});

describe('list parameters', () => {
  it('reads the status of the alerts and the type of the movements', () => {
    expect(readAlertStatus({ status: 'critical' })).toBe('critical');
    expect(readAlertStatus({})).toBeUndefined();
    expect(readMovementType({ type: 'transfer' })).toBe('transfer');
    expect(fieldOf(() => readAlertStatus({ status: 'urgent' }))).toBe('status');
    expect(fieldOf(() => readMovementType({ type: 'theft' }))).toBe('type');
  });

  it('reads the limit, with a default and a ceiling', () => {
    expect(readLimit({})).toBe(8);
    expect(readLimit({ limit: '25' })).toBe(25);
    expect(fieldOf(() => readLimit({ limit: '0' }))).toBe('limit');
    expect(fieldOf(() => readLimit({ limit: '101' }))).toBe('limit');
    expect(fieldOf(() => readLimit({ limit: '2.5' }))).toBe('limit');
  });
});
