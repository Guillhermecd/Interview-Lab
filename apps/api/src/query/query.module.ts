import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AppEnv } from '../config/env.js';
import { QueryController } from './query.controller.js';
import { QueryExecutor } from './query-executor.service.js';
import { QUERY_ENV, READONLY_POOL } from './query.tokens.js';
import { createReadonlyPool } from './readonly-pool.js';

@Module({})
export class QueryModule implements OnModuleDestroy {
  constructor(@Inject(READONLY_POOL) private readonly pool: Pool) {}

  static register(env: AppEnv): DynamicModule {
    return {
      module: QueryModule,
      // One pool for the whole application, shared with the health check.
      global: true,
      controllers: env.query.internalEndpointEnabled ? [QueryController] : [],
      providers: [
        { provide: READONLY_POOL, useFactory: () => createReadonlyPool(env.database) },
        { provide: QUERY_ENV, useValue: env.query },
        QueryExecutor,
      ],
      exports: [QueryExecutor, READONLY_POOL],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
