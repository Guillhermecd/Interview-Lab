import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

// DatabaseHealth comes from the global QueryModule.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
