import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';
import { AskModule } from '../ask/ask.module.js';
import type { AppEnv } from '../config/env.js';
import { APP_POOL, createAppPool } from './app-pool.js';
import { ConversationController } from './conversation.controller.js';
import { ConversationRepository } from './conversation.repository.js';
import { ConversationService } from './conversation.service.js';

@Module({})
export class ConversationModule implements OnModuleDestroy {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  static register(env: AppEnv): DynamicModule {
    return {
      module: ConversationModule,
      imports: [AskModule.register(env)],
      // Same flag as the internal query endpoint: no authentication yet (D-28).
      controllers: env.query.internalEndpointEnabled ? [ConversationController] : [],
      providers: [
        { provide: APP_POOL, useFactory: () => createAppPool(env.appDatabase) },
        ConversationRepository,
        ConversationService,
      ],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
