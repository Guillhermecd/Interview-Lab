import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AuthUser,
  CatalogOptions,
  CatalogProductDetail,
  CatalogProductPage,
  ProductStockLevel,
  RecordedStockMovement,
  StockMovementPage,
} from '@interview-lab/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import { CatalogAdminGuard } from '../auth/catalog-admin.guard.js';
import {
  readId,
  readMinimumStock,
  readMovementInput,
  readMovementListFilter,
  readProductInput,
  readProductListFilter,
} from './catalog-params.js';
import { CatalogService } from './catalog.service.js';

// The registry (Phase 09e): products and stock movements. Every route needs a
// session (401) and a user allowed to manage the catalog (403), checked on
// each request, reads included.
@Controller('catalog')
@UseGuards(AuthGuard, CatalogAdminGuard)
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  // What the forms offer: categories, units and distribution centers.
  @Get('options')
  options(): Promise<CatalogOptions> {
    return this.catalog.options();
  }

  @Get('products')
  listProducts(@Query() query: unknown): Promise<CatalogProductPage> {
    return this.catalog.listProducts(readProductListFilter(query));
  }

  @Get('products/:id')
  product(@Param('id') id: string): Promise<CatalogProductDetail> {
    return this.catalog.product(readId(id, 'id'));
  }

  @Post('products')
  createProduct(@Body() body: unknown): Promise<CatalogProductDetail> {
    return this.catalog.createProduct(readProductInput(body));
  }

  // Replaces the data of the product.
  @Put('products/:id')
  updateProduct(@Param('id') id: string, @Body() body: unknown): Promise<CatalogProductDetail> {
    return this.catalog.updateProduct(readId(id, 'id'), readProductInput(body));
  }

  // Archives the product; nothing is erased.
  @Delete('products/:id')
  archiveProduct(@Param('id') id: string): Promise<CatalogProductDetail> {
    return this.catalog.setProductActive(readId(id, 'id'), false);
  }

  @Post('products/:id/restore')
  @HttpCode(HttpStatus.OK)
  restoreProduct(@Param('id') id: string): Promise<CatalogProductDetail> {
    return this.catalog.setProductActive(readId(id, 'id'), true);
  }

  @Put('products/:id/stock-levels/:centerId')
  setMinimumStock(
    @Param('id') id: string,
    @Param('centerId') centerId: string,
    @Body() body: unknown,
  ): Promise<ProductStockLevel> {
    return this.catalog.setMinimumStock(
      readId(id, 'id'),
      readId(centerId, 'centerId'),
      readMinimumStock(body),
    );
  }

  @Get('stock-movements')
  listMovements(@Query() query: unknown): Promise<StockMovementPage> {
    return this.catalog.listMovements(readMovementListFilter(query));
  }

  // Records a movement and updates the balances in the same transaction.
  // There is no route to change or remove one: a mistake is fixed with an
  // adjustment, and the history stays whole.
  @Post('stock-movements')
  recordMovement(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<RecordedStockMovement> {
    return this.catalog.recordMovement(readMovementInput(body), user);
  }
}
