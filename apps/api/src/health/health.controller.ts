import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HEALTH_STATUS_OK, type HealthResponse } from '@interview-lab/shared';
import { DatabaseHealth } from '../query/database-health.service.js';
import { describeErrorForLog } from '../query/query-error.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DatabaseHealth) private readonly database: DatabaseHealth) {}

  // Healthy means the application is up and the database answers.
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.database.ping();
    } catch (error) {
      this.logger.error(`Database health check failed (${describeErrorForLog(error)})`);
      throw new ServiceUnavailableException();
    }
    return { status: HEALTH_STATUS_OK };
  }
}
