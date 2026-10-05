import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { OriginGuard } from './auth/origin.guard.js';
import { CatalogModule } from './catalog/catalog.module.js';
import type { AppEnv } from './config/env.js';
import { AppDataModule } from './conversation/app-data.module.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { HealthModule } from './health/health.module.js';
import { LimitsModule } from './limits/limits.module.js';
import { QueryModule } from './query/query.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({})
export class AppModule {
  static register(env: AppEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RedisModule.register(env.redis),
        AppDataModule.register(env.appDatabase),
        AuthModule.register(env.auth),
        LimitsModule.register(env.limits),
        QueryModule.register(env),
        HealthModule,
        ConversationModule.register(env),
        DashboardModule.register(env),
        CatalogModule.register(env),
      ],
      // CSRF protection on every route (D-08).
      providers: [{ provide: APP_GUARD, useExisting: OriginGuard }],
    };
  }
}
