import { Module, type DynamicModule } from '@nestjs/common';
import type { AppEnv } from './config/env.js';
import { ConversationModule } from './conversation/conversation.module.js';
import { HealthModule } from './health/health.module.js';
import { QueryModule } from './query/query.module.js';

@Module({})
export class AppModule {
  static register(env: AppEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [QueryModule.register(env), HealthModule, ConversationModule.register(env)],
    };
  }
}
