import type { DashboardKpis } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import { OVERVIEW } from '../../test/dashboard-fixtures';
import { kpiCards } from './kpi-cards';

function cardOf(kpis: DashboardKpis, key: keyof DashboardKpis) {
  const card = kpiCards(kpis).find((item) => item.key === key);
  if (!card) {
    throw new Error(`No card for ${key}`);
  }
  return card;
}

describe('kpiCards', () => {
  it('passes trend, sentiment and spark through untouched', () => {
    const card = cardOf(OVERVIEW.kpis, 'stockValue');

    expect(card.trend).toBe('up');
    expect(card.sentiment).toBe('neutral');
    expect(card.spark).toBe(OVERVIEW.kpis.stockValue.spark);
  });

  it('writes each indicator in its own unit', () => {
    expect(cardOf(OVERVIEW.kpis, 'revenue')).toMatchObject({ delta: '−1,8%' });
    expect(cardOf(OVERVIEW.kpis, 'coverageDays')).toMatchObject({
      value: '36 dias',
      delta: '+3 dias',
      sub: 'Cobertura média · giro 10,1×/ano',
    });
    expect(cardOf(OVERVIEW.kpis, 'belowMinimum')).toMatchObject({ value: '47', delta: '+18' });
    expect(cardOf(OVERVIEW.kpis, 'onTimeDelivery')).toMatchObject({
      value: '92,4%',
      delta: '−1,8 p.p.',
    });
    expect(cardOf(OVERVIEW.kpis, 'stockValue').sub).toBe('9 CDs · 200 SKUs ativos');
  });

  it('shows a dash for what the server could not compute', () => {
    const kpis: DashboardKpis = {
      ...OVERVIEW.kpis,
      onTimeDelivery: {
        ...OVERVIEW.kpis.onTimeDelivery,
        value: null,
        previousValue: null,
        delta: null,
        trend: 'flat',
        sentiment: 'neutral',
        onTimeOrders: 0,
        deliveredOrders: 0,
      },
      coverageDays: { ...OVERVIEW.kpis.coverageDays, value: null, delta: null, turnsPerYear: null },
      orders: { ...OVERVIEW.kpis.orders, value: 0, averageTicket: null },
    };

    expect(cardOf(kpis, 'onTimeDelivery')).toMatchObject({
      value: '—',
      delta: '—',
      sub: 'Meta 95% · 0 de 0',
    });
    expect(cardOf(kpis, 'coverageDays')).toMatchObject({
      value: '—',
      delta: '—',
      sub: 'Sem saídas no período',
    });
    expect(cardOf(kpis, 'orders').sub).toBe('Sem pedidos no período');
  });

  it('uses the singular for one', () => {
    const kpis: DashboardKpis = {
      ...OVERVIEW.kpis,
      coverageDays: { ...OVERVIEW.kpis.coverageDays, value: 1 },
      stockValue: { ...OVERVIEW.kpis.stockValue, distributionCenters: 1, activeProducts: 1 },
      belowMinimum: { ...OVERVIEW.kpis.belowMinimum, critical: 1 },
    };

    expect(cardOf(kpis, 'coverageDays').value).toBe('1 dia');
    expect(cardOf(kpis, 'stockValue').sub).toBe('1 CD · 1 SKU ativo');
    expect(cardOf(kpis, 'belowMinimum').sub).toBe('1 crítico · 35 em atenção');
  });
});
