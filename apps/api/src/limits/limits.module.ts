import { Module, type DynamicModule } from '@nestjs/common';
import type { LimitsEnv } from '../config/security-env.js';
import { RateLimiter } from './rate-limiter.js';
import { UsageController } from './usage.controller.js';
import { UsageRepository } from './usage.repository.js';
import { LIMITS_ENV, UsageService } from './usage.service.js';

@Module({})
export class LimitsModule {
  static register(env: LimitsEnv): DynamicModule {
    return {
      module: LimitsModule,
      global: true,
      controllers: [UsageController],
      providers: [
        { provide: LIMITS_ENV, useValue: env },
        RateLimiter,
        UsageRepository,
        UsageService,
      ],
      exports: [LIMITS_ENV, RateLimiter, UsageService],
    };
  }
}
