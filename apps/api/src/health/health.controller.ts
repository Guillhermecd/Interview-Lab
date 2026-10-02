import { Controller, Get } from '@nestjs/common';
import { HEALTH_STATUS_OK, type HealthResponse } from '@interview-lab/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: HEALTH_STATUS_OK };
  }
}
