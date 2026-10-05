import { Module, type DynamicModule } from '@nestjs/common';
import type { AppEnv } from '../config/env.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardRepository } from './dashboard.repository.js';
import { DASHBOARD_ENV, DashboardService } from './dashboard.service.js';

// Uses FixedReadQuery (QueryModule) and AuthGuard (AuthModule), both global.
@Module({})
export class DashboardModule {
  static register(env: AppEnv): DynamicModule {
    return {
      module: DashboardModule,
      controllers: [DashboardController],
      providers: [
        { provide: DASHBOARD_ENV, useValue: env.dashboard },
        DashboardRepository,
        DashboardService,
      ],
    };
  }
}
