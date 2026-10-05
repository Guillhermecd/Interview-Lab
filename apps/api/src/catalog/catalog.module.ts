import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AppEnv } from '../config/env.js';
import { CATALOG_POOL, createCatalogPool } from './catalog-pool.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

// The registry of products and stock movements. Its pool is the only way to
// write to `sales`, so this module exports nothing: no other part of the
// application (the chat least of all) can reach it.
@Module({})
export class CatalogModule implements OnModuleDestroy {
  constructor(@Inject(CATALOG_POOL) private readonly pool: Pool) {}

  static register(env: AppEnv): DynamicModule {
    return {
      module: CatalogModule,
      controllers: [CatalogController],
      providers: [
        { provide: CATALOG_POOL, useFactory: () => createCatalogPool(env.catalogDatabase) },
        CatalogRepository,
        CatalogService,
      ],
      exports: [],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
