import type {
  CatalogOptions,
  CatalogProduct,
  CatalogProductDetail,
  CatalogProductPage,
  RecordedStockMovement,
  StockMovementPage,
} from '@interview-lab/shared';
import { STOCK_MOVEMENTS } from './dashboard-fixtures';
import { jsonResponse, type FakeApi } from './fake-api';

// What the registry endpoints answer in component tests.

export const CATALOG_OPTIONS: CatalogOptions = {
  categories: ['Aço e metais', 'Cimento e argamassa'],
  units: ['sc', 'br', 'rl', 'pr', 'un'],
  distributionCenters: [
    { id: '1', name: 'CD Campinas' },
    { id: '2', name: 'CD Curitiba' },
  ],
};

export const CEMENT: CatalogProduct = {
  id: '1',
  sku: 'RM-0001',
  name: 'Cimento CP-II-E-32 50 kg',
  category: 'Cimento e argamassa',
  unit: 'sc',
  price: 38,
  cost: 25.5,
  active: true,
  totalQuantity: 4200,
};

export const OLD_REBAR: CatalogProduct = {
  id: '2',
  sku: 'RM-0002',
  name: 'Vergalhão antigo',
  category: 'Aço e metais',
  unit: 'br',
  price: 40,
  cost: 30,
  active: false,
  totalQuantity: 0,
};

export const PRODUCT_PAGE: CatalogProductPage = {
  items: [CEMENT, OLD_REBAR],
  page: 1,
  pageSize: 20,
  total: 45,
};

export const CEMENT_DETAIL: CatalogProductDetail = {
  ...CEMENT,
  stockLevels: [
    {
      distributionCenterId: '1',
      distributionCenter: 'CD Campinas',
      quantity: 3000,
      minimumQuantity: 800,
    },
    {
      distributionCenterId: '2',
      distributionCenter: 'CD Curitiba',
      quantity: 1200,
      minimumQuantity: 0,
    },
  ],
};

export const MOVEMENT_PAGE: StockMovementPage = {
  items: STOCK_MOVEMENTS.items,
  page: 1,
  pageSize: 10,
  total: 4,
};

export const RECORDED_MOVEMENT: RecordedStockMovement = {
  movement: {
    id: '9',
    movedAt: '2026-10-05T18:00:00.000Z',
    type: 'outbound',
    product: CEMENT.name,
    unit: 'sc',
    distributionCenter: 'CD Campinas',
    quantity: 50,
    responsibleName: 'Ana',
    document: 'Pedido 77',
  },
  stockLevels: [
    {
      distributionCenterId: '1',
      distributionCenter: 'CD Campinas',
      quantity: 2950,
      minimumQuantity: 800,
    },
  ],
};

// Answers the read endpoints of the registry, whatever the query string.
export function stubCatalog(api: FakeApi): FakeApi {
  return api
    .on('GET /api/catalog/options', () => jsonResponse(CATALOG_OPTIONS))
    .on('GET /api/catalog/products', () => jsonResponse(PRODUCT_PAGE))
    .on('GET /api/catalog/products/1', () => jsonResponse(CEMENT_DETAIL))
    .on('GET /api/catalog/stock-movements', () => jsonResponse(MOVEMENT_PAGE));
}
