import { Module, type DynamicModule } from '@nestjs/common';
import { AskModule } from '../ask/ask.module.js';
import type { AppEnv } from '../config/env.js';
import { ConversationController } from './conversation.controller.js';
import { ConversationRepository } from './conversation.repository.js';
import { ConversationService } from './conversation.service.js';

// Conversations belong to the signed-in user (Phase 08); the endpoints no
// longer depend on the internal flag (D-28).
@Module({})
export class ConversationModule {
  static register(env: AppEnv): DynamicModule {
    return {
      module: ConversationModule,
      imports: [AskModule.register(env)],
      controllers: [ConversationController],
      providers: [ConversationRepository, ConversationService],
    };
  }
}
