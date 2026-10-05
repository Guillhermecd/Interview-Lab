import { Inject, Injectable } from '@nestjs/common';
import type {
  CatalogOptions,
  CatalogProduct,
  ProductInput,
  ProductStatusFilter,
  ProductStockLevel,
  ProductUnit,
  StockMovement,
  StockMovementInput,
  StockMovementType,
} from '@interview-lab/shared';
import { PRODUCT_UNITS } from '@interview-lab/shared';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { FixedReadQuery } from '../query/fixed-read-query.service.js';
import { CatalogError } from './catalog-error.js';
import { CATALOG_POOL } from './catalog-pool.js';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const NUMERIC_VALUE_OUT_OF_RANGE = '22003';
const SKU_CONSTRAINT = 'products_sku_key';

export interface ProductListFilter {
  search?: string | undefined;
  category?: string | undefined;
  status: ProductStatusFilter;
  page: number;
  pageSize: number;
}

export interface MovementListFilter {
  productId?: string | undefined;
  type?: StockMovementType | undefined;
  page: number;
  pageSize: number;
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: ProductUnit;
  price: string;
  cost: string;
  active: boolean;
  total_quantity: string;
}

interface MovementRow {
  id: string;
  moved_at: Date;
  type: StockMovementType;
  product: string;
  unit: string;
  distribution_center: string;
  destination_center: string | null;
  quantity: number;
  responsible_name: string;
  document: string;
}

// Fixed text; values always go as parameters.
const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.name, p.category, p.unit, p.price, p.cost, p.active,
         coalesce(stock.total, 0) AS total_quantity
  FROM sales.products p
  LEFT JOIN (
    SELECT product_id, sum(quantity) AS total FROM sales.stock_levels GROUP BY product_id
  ) stock ON stock.product_id = p.id`;

// $1 search (already escaped for LIKE), $2 category, $3 active or null for all.
const PRODUCT_FILTER = `
  ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%')
  AND ($2::text IS NULL OR p.category = $2)
  AND ($3::boolean IS NULL OR p.active = $3)`;

const MOVEMENT_SELECT = `
  SELECT m.id, m.moved_at, m.type, p.name AS product, p.unit,
         dc.name AS distribution_center, destination.name AS destination_center,
         m.quantity, m.responsible_name, m.document
  FROM sales.stock_movements m
  JOIN sales.products p ON p.id = m.product_id
  JOIN sales.distribution_centers dc ON dc.id = m.distribution_center_id
  LEFT JOIN sales.distribution_centers destination ON destination.id = m.destination_center_id`;

const MOVEMENT_FILTER = `
  ($1::bigint IS NULL OR m.product_id = $1) AND ($2::text IS NULL OR m.type = $2)`;

function toProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    price: Number(row.price),
    cost: Number(row.cost),
    active: row.active,
    totalQuantity: Number(row.total_quantity),
  };
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    movedAt: row.moved_at.toISOString(),
    type: row.type,
    product: row.product,
    unit: row.unit,
    distributionCenter: row.distribution_center,
    ...(row.destination_center !== null && { destinationCenter: row.destination_center }),
    quantity: row.quantity,
    responsibleName: row.responsible_name,
    document: row.document,
  };
}

// Text typed by the user is searched literally: % and _ are not wildcards.
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

function activeFilter(status: ProductStatusFilter): boolean | null {
  if (status === 'all') {
    return null;
  }
  return status === 'active';
}

// A product with the same SKU or name already exists.
function toConflict(error: unknown): unknown {
  if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) {
    return new CatalogError(error.constraint === SKU_CONSTRAINT ? 'SKU_IN_USE' : 'NAME_IN_USE');
  }
  return error;
}

// How much each center gains or loses with a movement, in center order: two
// transfers in opposite directions then lock the same rows in the same order.
function stockChanges(input: StockMovementInput): { centerId: string; delta: number }[] {
  const { distributionCenterId: center, quantity } = input;
  switch (input.type) {
    case 'inbound':
      return [{ centerId: center, delta: quantity }];
    case 'outbound':
      return [{ centerId: center, delta: -quantity }];
    case 'adjustment':
      return [{ centerId: center, delta: quantity }];
    case 'transfer':
      return [
        { centerId: center, delta: -quantity },
        { centerId: input.destinationCenterId ?? center, delta: quantity },
      ].sort((first, second) => Number(first.centerId) - Number(second.centerId));
  }
}

// Products and stock movements. Reads go through the read-only pool, like the
// dashboard; writes go through the catalog pool, the only one that can write
// to `sales` (D-56). Every statement is fixed text with parameters.
@Injectable()
export class CatalogRepository {
  constructor(
    @Inject(CATALOG_POOL) private readonly pool: Pool,
    @Inject(FixedReadQuery) private readonly reads: FixedReadQuery,
  ) {}

  async options(): Promise<CatalogOptions> {
    const categories = await this.reads.rows<{ category: string }>(
      'SELECT DISTINCT p.category FROM sales.products p ORDER BY p.category',
    );
    const centers = await this.reads.rows<{ id: string; name: string }>(
      'SELECT dc.id, dc.name FROM sales.distribution_centers dc ORDER BY dc.name',
    );
    return {
      categories: categories.map((row) => row.category),
      units: [...PRODUCT_UNITS],
      distributionCenters: centers,
    };
  }

  async listProducts(
    filter: ProductListFilter,
  ): Promise<{ items: CatalogProduct[]; total: number }> {
    const values = [
      filter.search === undefined ? null : escapeLike(filter.search),
      filter.category ?? null,
      activeFilter(filter.status),
    ];
    const rows = await this.reads.rows<ProductRow>(
      `${PRODUCT_SELECT} WHERE ${PRODUCT_FILTER} ORDER BY p.name, p.id LIMIT $4 OFFSET $5`,
      [...values, filter.pageSize, (filter.page - 1) * filter.pageSize],
    );
    const count = await this.reads.rows<{ total: string }>(
      `SELECT count(*) AS total FROM sales.products p WHERE ${PRODUCT_FILTER}`,
      values,
    );
    return { items: rows.map(toProduct), total: Number(count[0]?.total ?? 0) };
  }

  async findProduct(productId: string): Promise<CatalogProduct | undefined> {
    const rows = await this.reads.rows<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [
      productId,
    ]);
    return rows[0] === undefined ? undefined : toProduct(rows[0]);
  }

  // The stock of the product in every center, including those with none.
  async stockLevels(productId: string): Promise<ProductStockLevel[]> {
    const rows = await this.reads.rows<{
      id: string;
      name: string;
      quantity: number;
      minimum_quantity: number;
    }>(
      `SELECT dc.id, dc.name,
              coalesce(s.quantity, 0) AS quantity,
              coalesce(s.minimum_quantity, 0) AS minimum_quantity
       FROM sales.distribution_centers dc
       LEFT JOIN sales.stock_levels s
         ON s.distribution_center_id = dc.id AND s.product_id = $1
       ORDER BY dc.name`,
      [productId],
    );
    return rows.map((row) => ({
      distributionCenterId: row.id,
      distributionCenter: row.name,
      quantity: row.quantity,
      minimumQuantity: row.minimum_quantity,
    }));
  }

  async listMovements(
    filter: MovementListFilter,
  ): Promise<{ items: StockMovement[]; total: number }> {
    const values = [filter.productId ?? null, filter.type ?? null];
    const rows = await this.reads.rows<MovementRow>(
      `${MOVEMENT_SELECT} WHERE ${MOVEMENT_FILTER}
       ORDER BY m.moved_at DESC, m.id DESC LIMIT $3 OFFSET $4`,
      [...values, filter.pageSize, (filter.page - 1) * filter.pageSize],
    );
    const count = await this.reads.rows<{ total: string }>(
      `SELECT count(*) AS total FROM sales.stock_movements m WHERE ${MOVEMENT_FILTER}`,
      values,
    );
    return { items: rows.map(toMovement), total: Number(count[0]?.total ?? 0) };
  }

  async findMovement(movementId: string): Promise<StockMovement | undefined> {
    const rows = await this.reads.rows<MovementRow>(`${MOVEMENT_SELECT} WHERE m.id = $1`, [
      movementId,
    ]);
    return rows[0] === undefined ? undefined : toMovement(rows[0]);
  }

  // Returns the id of the new product.
  async createProduct(input: ProductInput): Promise<string> {
    try {
      const result = await this.pool.query<{ id: string }>(
        `INSERT INTO sales.products (sku, name, category, unit, price, cost)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [input.sku, input.name, input.category, input.unit, input.price, input.cost],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('INSERT INTO sales.products returned no row');
      }
      return row.id;
    } catch (error) {
      throw toConflict(error);
    }
  }

  // False when there is no such product.
  async updateProduct(productId: string, input: ProductInput): Promise<boolean> {
    try {
      const result = await this.pool.query(
        `UPDATE sales.products
         SET sku = $2, name = $3, category = $4, unit = $5, price = $6, cost = $7
         WHERE id = $1`,
        [productId, input.sku, input.name, input.category, input.unit, input.price, input.cost],
      );
      return result.rowCount === 1;
    } catch (error) {
      throw toConflict(error);
    }
  }

  // Archiving keeps the product in the history of orders and stock.
  async setProductActive(productId: string, active: boolean): Promise<boolean> {
    const result = await this.pool.query('UPDATE sales.products SET active = $2 WHERE id = $1', [
      productId,
      active,
    ]);
    return result.rowCount === 1;
  }

  // Creates the balance (at zero) when the center never held the product.
  async setMinimumStock(productId: string, centerId: string, minimum: number): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO sales.stock_levels (distribution_center_id, product_id, quantity, minimum_quantity)
         VALUES ($1, $2, 0, $3)
         ON CONFLICT (distribution_center_id, product_id)
         DO UPDATE SET minimum_quantity = EXCLUDED.minimum_quantity`,
        [centerId, productId, minimum],
      );
    } catch (error) {
      if (error instanceof DatabaseError && error.code === FOREIGN_KEY_VIOLATION) {
        throw new CatalogError(
          error.constraint?.includes('product') === true
            ? 'PRODUCT_NOT_FOUND'
            : 'DISTRIBUTION_CENTER_NOT_FOUND',
        );
      }
      throw error;
    }
  }

  // Records the movement and updates the balances in one transaction: either
  // both happen or neither. Returns the id of the movement.
  async recordMovement(input: StockMovementInput, responsibleName: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertProductAcceptsMovements(client, input.productId);
      for (const change of stockChanges(input)) {
        await this.applyStockChange(client, input.productId, change.centerId, change.delta);
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sales.stock_movements
           (moved_at, type, product_id, distribution_center_id, destination_center_id, quantity,
            responsible_name, document)
         VALUES (now(), $1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          input.type,
          input.productId,
          input.distributionCenterId,
          input.type === 'transfer' ? (input.destinationCenterId ?? null) : null,
          input.quantity,
          responsibleName,
          input.document,
        ],
      );
      await client.query('COMMIT');
      const row = inserted.rows[0];
      if (row === undefined) {
        throw new Error('INSERT INTO sales.stock_movements returned no row');
      }
      return row.id;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw this.translateMovementError(error);
    } finally {
      client.release();
    }
  }

  private async assertProductAcceptsMovements(
    client: PoolClient,
    productId: string,
  ): Promise<void> {
    const product = await client.query<{ active: boolean }>(
      'SELECT active FROM sales.products WHERE id = $1',
      [productId],
    );
    const row = product.rows[0];
    if (row === undefined) {
      throw new CatalogError('PRODUCT_NOT_FOUND');
    }
    if (!row.active) {
      throw new CatalogError('PRODUCT_ARCHIVED');
    }
  }

  // Adds to a balance (creating it if needed) or takes from it. Taking is one
  // conditional UPDATE: it only matches while the balance covers the amount,
  // so two requests at the same time cannot both take the last units.
  private async applyStockChange(
    client: PoolClient,
    productId: string,
    centerId: string,
    delta: number,
  ): Promise<void> {
    if (delta >= 0) {
      await client.query(
        `INSERT INTO sales.stock_levels (distribution_center_id, product_id, quantity, minimum_quantity)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (distribution_center_id, product_id)
         DO UPDATE SET quantity = sales.stock_levels.quantity + EXCLUDED.quantity`,
        [centerId, productId, delta],
      );
      return;
    }
    const taken = await client.query(
      `UPDATE sales.stock_levels
       SET quantity = quantity + $3
       WHERE distribution_center_id = $1 AND product_id = $2 AND quantity + $3 >= 0`,
      [centerId, productId, delta],
    );
    if (taken.rowCount !== 1) {
      throw new CatalogError('INSUFFICIENT_STOCK');
    }
  }

  private translateMovementError(error: unknown): unknown {
    if (!(error instanceof DatabaseError)) {
      return error;
    }
    // The product was checked above, so a missing reference is a center.
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return new CatalogError('DISTRIBUTION_CENTER_NOT_FOUND');
    }
    if (error.code === NUMERIC_VALUE_OUT_OF_RANGE) {
      return new CatalogError('STOCK_LIMIT_EXCEEDED');
    }
    return error;
  }
}
