import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthUser,
  CatalogOptions,
  CatalogProductDetail,
  CatalogProductPage,
  ProductInput,
  ProductStockLevel,
  RecordedStockMovement,
  StockMovementInput,
  StockMovementPage,
} from '@interview-lab/shared';
import { ValidationError } from '../http/validation-error.js';
import { SalesDataVersion } from '../redis/sales-data-version.js';
import { CatalogError } from './catalog-error.js';
import {
  CatalogRepository,
  type MovementListFilter,
  type ProductListFilter,
} from './catalog.repository.js';

// The registry of products and stock movements (D-56). Every rule is enforced
// here or in the database, whatever the screen already checked: unique SKU and
// name, known category and centers, stock that covers what leaves. After each
// write, cached query results are invalidated.
@Injectable()
export class CatalogService {
  constructor(
    @Inject(CatalogRepository) private readonly repository: CatalogRepository,
    @Inject(SalesDataVersion) private readonly dataVersion: Pick<SalesDataVersion, 'bump'>,
  ) {}

  options(): Promise<CatalogOptions> {
    return this.repository.options();
  }

  async listProducts(filter: ProductListFilter): Promise<CatalogProductPage> {
    const { items, total } = await this.repository.listProducts(filter);
    return { items, page: filter.page, pageSize: filter.pageSize, total };
  }

  async product(productId: string): Promise<CatalogProductDetail> {
    const product = await this.repository.findProduct(productId);
    if (product === undefined) {
      throw new CatalogError('PRODUCT_NOT_FOUND');
    }
    return { ...product, stockLevels: await this.repository.stockLevels(productId) };
  }

  async createProduct(input: ProductInput): Promise<CatalogProductDetail> {
    await this.assertKnownCategory(input.category);
    const productId = await this.repository.createProduct(input);
    await this.dataVersion.bump();
    return this.product(productId);
  }

  async updateProduct(productId: string, input: ProductInput): Promise<CatalogProductDetail> {
    await this.assertKnownCategory(input.category);
    if (!(await this.repository.updateProduct(productId, input))) {
      throw new CatalogError('PRODUCT_NOT_FOUND');
    }
    await this.dataVersion.bump();
    return this.product(productId);
  }

  // "Deleting" a product archives it: the history of orders and stock stays.
  async setProductActive(productId: string, active: boolean): Promise<CatalogProductDetail> {
    if (!(await this.repository.setProductActive(productId, active))) {
      throw new CatalogError('PRODUCT_NOT_FOUND');
    }
    await this.dataVersion.bump();
    return this.product(productId);
  }

  async setMinimumStock(
    productId: string,
    centerId: string,
    minimum: number,
  ): Promise<ProductStockLevel> {
    await this.repository.setMinimumStock(productId, centerId, minimum);
    await this.dataVersion.bump();
    return this.stockLevel(productId, centerId);
  }

  async listMovements(filter: MovementListFilter): Promise<StockMovementPage> {
    const { items, total } = await this.repository.listMovements(filter);
    return { items, page: filter.page, pageSize: filter.pageSize, total };
  }

  // The responsible person is the signed-in user, never a name sent by the client.
  async recordMovement(input: StockMovementInput, user: AuthUser): Promise<RecordedStockMovement> {
    await this.assertKnownCenters(input);
    const movementId = await this.repository.recordMovement(input, user.name);
    await this.dataVersion.bump();

    const movement = await this.repository.findMovement(movementId);
    if (movement === undefined) {
      throw new Error(`Stock movement ${movementId} vanished after being recorded`);
    }
    const changed = new Set([input.distributionCenterId, input.destinationCenterId]);
    const levels = await this.repository.stockLevels(input.productId);
    return {
      movement,
      stockLevels: levels.filter((level) => changed.has(level.distributionCenterId)),
    };
  }

  private async stockLevel(productId: string, centerId: string): Promise<ProductStockLevel> {
    const levels = await this.repository.stockLevels(productId);
    const level = levels.find((item) => item.distributionCenterId === centerId);
    if (level === undefined) {
      throw new CatalogError('DISTRIBUTION_CENTER_NOT_FOUND');
    }
    return level;
  }

  // New products only join an existing category (D-59): the dashboard gives
  // each category its own color, and has as many colors as there are categories.
  private async assertKnownCategory(category: string): Promise<void> {
    const { categories } = await this.repository.options();
    if (!categories.includes(category)) {
      throw new ValidationError([
        { field: 'category', message: `Escolha uma das categorias: ${categories.join(', ')}.` },
      ]);
    }
  }

  private async assertKnownCenters(input: StockMovementInput): Promise<void> {
    const { distributionCenters } = await this.repository.options();
    const known = new Set(distributionCenters.map((center) => center.id));
    const asked = [input.distributionCenterId, input.destinationCenterId].filter(
      (centerId) => centerId !== undefined,
    );
    if (asked.some((centerId) => !known.has(centerId))) {
      throw new CatalogError('DISTRIBUTION_CENTER_NOT_FOUND');
    }
  }
}
