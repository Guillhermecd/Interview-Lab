import type {
  CatalogOptions,
  CatalogProductDetail,
  CatalogProductPage,
  MinimumStockInput,
  ProductInput,
  ProductStatusFilter,
  ProductStockLevel,
  RecordedStockMovement,
  StockMovementInput,
  StockMovementPage,
  StockMovementType,
} from '@interview-lab/shared';
import { requestJson } from './api';

const BASE_PATH = '/catalog';
const JSON_HEADERS = { 'content-type': 'application/json' };

export interface ProductListQuery {
  search?: string | undefined;
  category?: string | undefined;
  status?: ProductStatusFilter | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface MovementListQuery {
  productId?: string | undefined;
  type?: StockMovementType | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
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

function send<Body>(method: string, path: string, body?: unknown): Promise<Body> {
  return requestJson<Body>(`${BASE_PATH}${path}`, {
    method,
    ...(body !== undefined && { headers: JSON_HEADERS, body: JSON.stringify(body) }),
  });
}

// The registry: only transports what the user typed. Every rule (unique SKU,
// known category, stock that covers what leaves) is enforced by the server.
export const CatalogService = {
  options(signal?: AbortSignal): Promise<CatalogOptions> {
    return requestJson<CatalogOptions>(`${BASE_PATH}/options`, { signal: signal ?? null });
  },

  listProducts(query: ProductListQuery, signal?: AbortSignal): Promise<CatalogProductPage> {
    return requestJson<CatalogProductPage>(`${BASE_PATH}/products${queryString({ ...query })}`, {
      signal: signal ?? null,
    });
  },

  product(productId: string, signal?: AbortSignal): Promise<CatalogProductDetail> {
    return requestJson<CatalogProductDetail>(`${BASE_PATH}/products/${productId}`, {
      signal: signal ?? null,
    });
  },

  createProduct(input: ProductInput): Promise<CatalogProductDetail> {
    return send('POST', '/products', input);
  },

  updateProduct(productId: string, input: ProductInput): Promise<CatalogProductDetail> {
    return send('PUT', `/products/${productId}`, input);
  },

  // Archives the product: nothing is erased.
  archiveProduct(productId: string): Promise<CatalogProductDetail> {
    return send('DELETE', `/products/${productId}`);
  },

  restoreProduct(productId: string): Promise<CatalogProductDetail> {
    return send('POST', `/products/${productId}/restore`);
  },

  setMinimumStock(
    productId: string,
    centerId: string,
    input: MinimumStockInput,
  ): Promise<ProductStockLevel> {
    return send('PUT', `/products/${productId}/stock-levels/${centerId}`, input);
  },

  listMovements(query: MovementListQuery, signal?: AbortSignal): Promise<StockMovementPage> {
    return requestJson<StockMovementPage>(
      `${BASE_PATH}/stock-movements${queryString({ ...query })}`,
      { signal: signal ?? null },
    );
  },

  recordMovement(input: StockMovementInput): Promise<RecordedStockMovement> {
    return send('POST', '/stock-movements', input);
  },
};
