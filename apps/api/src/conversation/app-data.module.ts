import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AppDatabaseEnv } from '../config/env.js';
import { APP_POOL, createAppPool } from './app-pool.js';

// The pool of the application data (role app_rw), shared by conversations,
// users and usage accounting.
@Module({})
export class AppDataModule implements OnModuleDestroy {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  static register(database: AppDatabaseEnv): DynamicModule {
    return {
      module: AppDataModule,
      global: true,
      providers: [{ provide: APP_POOL, useFactory: () => createAppPool(database) }],
      exports: [APP_POOL],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
