import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HEALTH_STATUS_OK, type HealthResponse } from '@interview-lab/shared';
import type { Pool } from 'pg';
import { describeErrorForLog } from '../query/query-error.js';
import { READONLY_POOL } from '../query/query.tokens.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(READONLY_POOL) private readonly pool: Pool) {}

  // Healthy means the application is up and the database answers.
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.pool.query('SELECT 1');
    } catch (error) {
      this.logger.error(`Database health check failed (${describeErrorForLog(error)})`);
      throw new ServiceUnavailableException();
    }
    return { status: HEALTH_STATUS_OK };
  }
}
