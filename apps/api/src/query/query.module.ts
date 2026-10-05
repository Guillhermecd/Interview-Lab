import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import { loadModule } from 'libpg-query';
import type { AppEnv } from '../config/env.js';
import { MAX_JOINS, SqlGuard } from '../sql-guard/sql-guard.js';
import { DatabaseHealth } from './database-health.service.js';
import { FixedReadQuery } from './fixed-read-query.service.js';
import { GuardedQueryService } from './guarded-query.service.js';
import { QueryController } from './query.controller.js';
import { QueryExecutor } from './query-executor.service.js';
import { QUERY_ENV, READONLY_POOL, SQL_GUARD } from './query.tokens.js';
import { createReadonlyPool } from './readonly-pool.js';
import { SchemaCatalog } from './schema-catalog.service.js';

@Module({})
export class QueryModule implements OnModuleDestroy {
  constructor(@Inject(READONLY_POOL) private readonly pool: Pool) {}

  static register(env: AppEnv): DynamicModule {
    return {
      module: QueryModule,
      // Global so the health check can use DatabaseHealth without re-registering the pool.
      global: true,
      controllers: env.query.internalEndpointEnabled ? [QueryController] : [],
      providers: [
        { provide: READONLY_POOL, useFactory: () => createReadonlyPool(env.database) },
        { provide: QUERY_ENV, useValue: env.query },
        {
          provide: SQL_GUARD,
          // The parser is a WebAssembly module that must be loaded before first use.
          useFactory: async () => {
            await loadModule();
            return new SqlGuard({ maxRows: env.query.maxRows, maxJoins: MAX_JOINS });
          },
        },
        QueryExecutor,
        GuardedQueryService,
        DatabaseHealth,
        SchemaCatalog,
        FixedReadQuery,
      ],
      // The pool and QueryExecutor stay private. Outside this module, SQL text
      // that came from a user or from the LLM only runs through
      // GuardedQueryService; FixedReadQuery is for statements written in the
      // code, with values as parameters (D-54).
      exports: [GuardedQueryService, DatabaseHealth, SchemaCatalog, FixedReadQuery],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
