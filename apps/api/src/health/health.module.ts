import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

// READONLY_POOL comes from the global QueryModule.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
