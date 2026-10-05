import type {
  DashboardFilterOptions,
  DashboardOverview,
  StockAlertList,
  StockMovementList,
} from '@interview-lab/shared';
import { jsonResponse, type FakeApi } from './fake-api';

// What the dashboard endpoints answer in component tests: small, and with
// numbers that are easy to recognise on screen.

export const FILTER_OPTIONS: DashboardFilterOptions = {
  distributionCenters: [
    { id: '1', name: 'CD Campinas', regionId: '1' },
    { id: '2', name: 'CD Curitiba', regionId: '2' },
  ],
  regions: [
    { id: '1', name: 'Sudeste' },
    { id: '2', name: 'Sul' },
  ],
  categories: ['Aço e metais', 'Cimento e argamassa'],
};

export const OVERVIEW: DashboardOverview = {
  period: 'month',
  range: { from: '2026-09-01', to: '2026-09-30' },
  previousRange: { from: '2026-08-02', to: '2026-08-31' },
  dataUntil: '2026-09-30T21:00:00.000Z',
  categories: ['Aço e metais', 'Cimento e argamassa'],
  kpis: {
    revenue: {
      value: 43_800_000,
      previousValue: 44_620_000,
      delta: -1.8,
      trend: 'down',
      sentiment: 'bad',
      spark: [41, 42, 44, 43, 45, 44, 43],
    },
    orders: {
      value: 2384,
      previousValue: 2431,
      delta: -1.9,
      trend: 'down',
      sentiment: 'bad',
      spark: [2290, 2350, 2410, 2380, 2460, 2431, 2384],
      averageTicket: 18_372.4,
      averageTicketDeltaPercent: 0.1,
    },
    stockValue: {
      value: 128_400_000,
      previousValue: 125_100_000,
      delta: 2.6,
      trend: 'up',
      sentiment: 'neutral',
      spark: [119, 121, 123, 122, 124, 125, 128],
      distributionCenters: 9,
      activeProducts: 200,
    },
    coverageDays: {
      value: 36,
      previousValue: 33,
      delta: 3,
      trend: 'up',
      sentiment: 'bad',
      spark: [],
      turnsPerYear: 10.1,
    },
    belowMinimum: {
      value: 47,
      previousValue: 29,
      delta: 18,
      trend: 'up',
      sentiment: 'bad',
      spark: [22, 25, 24, 27, 26, 29, 47],
      critical: 12,
      attention: 35,
    },
    onTimeDelivery: {
      value: 92.4,
      previousValue: 94.2,
      delta: -1.8,
      trend: 'down',
      sentiment: 'bad',
      spark: [95.1, 94.6, 94.9, 94, 94.4, 94.2, 92.4],
      targetPercent: 95,
      onTimeOrders: 2203,
      deliveredOrders: 2384,
    },
  },
  revenueSeries: [
    {
      date: '2026-09-01',
      revenue: 1_400_000,
      cumulative: 1_400_000,
      previousDate: '2026-08-02',
      previousRevenue: 1_500_000,
      previousCumulative: 1_500_000,
    },
    {
      date: '2026-09-02',
      revenue: 1_600_000,
      cumulative: 3_000_000,
      previousDate: '2026-08-03',
      previousRevenue: 1_450_000,
      previousCumulative: 2_950_000,
    },
  ],
  revenueByRegion: [
    {
      regionId: '1',
      name: 'Sudeste',
      revenue: 19_476_550,
      previousRevenue: 21_047_200,
      deltaPercent: -7.5,
      trend: 'down',
      sentiment: 'bad',
    },
    {
      regionId: '2',
      name: 'Sul',
      revenue: 9_820_000,
      previousRevenue: 9_524_000,
      deltaPercent: 3.1,
      trend: 'up',
      sentiment: 'good',
    },
  ],
  topProducts: {
    items: [
      {
        productId: '1',
        name: 'Cimento CP-II-E-32 50 kg',
        category: 'Cimento e argamassa',
        revenue: 3_840_000,
      },
      {
        productId: '9',
        name: 'Vergalhão CA-50 10 mm',
        category: 'Aço e metais',
        revenue: 3_210_000,
      },
    ],
    sharePercent: 41.3,
  },
  stockByCenter: [
    {
      distributionCenterId: '1',
      name: 'CD Campinas',
      total: 22_000_000,
      byCategory: [12_000_000, 10_000_000],
    },
    {
      distributionCenterId: '2',
      name: 'CD Curitiba',
      total: 15_600_000,
      byCategory: [9_600_000, 6_000_000],
    },
  ],
  abc: {
    activeProducts: 200,
    classes: [
      { class: 'A', products: 45, revenueSharePercent: 80 },
      { class: 'B', products: 65, revenueSharePercent: 15.2 },
      { class: 'C', products: 90, revenueSharePercent: 4.8 },
    ],
    points: [
      { productsPercent: 0, revenuePercent: 0 },
      { productsPercent: 22.5, revenuePercent: 80 },
      { productsPercent: 55, revenuePercent: 95.2 },
      { productsPercent: 100, revenuePercent: 100 },
    ],
    classAEndPercent: 22.5,
    classBEndPercent: 55,
  },
};

export const STOCK_ALERTS: StockAlertList = {
  counts: { all: 56, critical: 12, attention: 35, ok: 9 },
  items: [
    {
      productId: '9',
      product: 'Vergalhão CA-50 10 mm',
      unit: 'br',
      distributionCenterId: '1',
      distributionCenter: 'CD Campinas',
      quantity: 1240,
      minimumQuantity: 4000,
      coverageDays: 2,
      status: 'critical',
    },
    {
      productId: '1',
      product: 'Cimento CP-II-E-32 50 kg',
      unit: 'sc',
      distributionCenterId: '2',
      distributionCenter: 'CD Curitiba',
      quantity: 5600,
      minimumQuantity: 6000,
      coverageDays: null,
      status: 'attention',
    },
  ],
};

export const STOCK_MOVEMENTS: StockMovementList = {
  items: [
    {
      id: '4',
      movedAt: '2026-09-30T20:42:00.000Z',
      type: 'outbound',
      product: 'Cimento CP-II-E-32 50 kg',
      unit: 'sc',
      distributionCenter: 'CD Campinas',
      quantity: 1200,
      responsibleName: 'Juliana Prado',
      document: 'Pedido 418223',
    },
    {
      id: '3',
      movedAt: '2026-09-30T19:15:00.000Z',
      type: 'inbound',
      product: 'Vergalhão CA-50 10 mm',
      unit: 'br',
      distributionCenter: 'CD Curitiba',
      quantity: 2400,
      responsibleName: 'Rafael Nogueira',
      document: 'NF-e 88412',
    },
    {
      id: '2',
      movedAt: '2026-09-30T18:03:00.000Z',
      type: 'transfer',
      product: 'Cabo flexível 2,5 mm 100 m',
      unit: 'rl',
      distributionCenter: 'CD Campinas',
      destinationCenter: 'CD Curitiba',
      quantity: 300,
      responsibleName: 'Patrícia Lemos',
      document: 'TRF 6031',
    },
    {
      id: '1',
      movedAt: '2026-09-30T14:28:00.000Z',
      type: 'adjustment',
      product: 'Luva nitrílica (par)',
      unit: 'pr',
      distributionCenter: 'CD Curitiba',
      quantity: -36,
      responsibleName: 'Marcos Vieira',
      document: 'Inventário cíclico',
    },
  ],
};

// Answers every dashboard endpoint, whatever the query string.
export function stubDashboard(api: FakeApi): FakeApi {
  return api
    .on('GET /api/dashboard/filters', () => jsonResponse(FILTER_OPTIONS))
    .on('GET /api/dashboard/overview', () => jsonResponse(OVERVIEW))
    .on('GET /api/dashboard/stock-alerts', () => jsonResponse(STOCK_ALERTS))
    .on('GET /api/dashboard/stock-movements', () => jsonResponse(STOCK_MOVEMENTS));
}
