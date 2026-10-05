import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import type {
  DashboardFilterOptions,
  DashboardOverview,
  StockAlertList,
  StockMovementList,
} from '@interview-lab/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  readAlertStatus,
  readFilters,
  readLimit,
  readMovementType,
  readOverviewRequest,
} from './dashboard-params.js';
import { businessDay } from './dashboard-period.js';
import { DashboardService } from './dashboard.service.js';

// The operations dashboard (Phase 09c): read-only aggregates of `sales` for any
// signed-in user. Filters arrive as query parameters and are validated before
// anything reaches the database.
@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  // What the filters can be set to.
  @Get('filters')
  filters(): Promise<DashboardFilterOptions> {
    return this.dashboard.filterOptions();
  }

  // Indicators and charts of a period, compared with the period before it.
  @Get('overview')
  overview(@Query() query: unknown): Promise<DashboardOverview> {
    const now = new Date();
    return this.dashboard.overview(readOverviewRequest(query, businessDay(now)), now);
  }

  // Products below or near their minimum stock, right now.
  @Get('stock-alerts')
  stockAlerts(@Query() query: unknown): Promise<StockAlertList> {
    return this.dashboard.stockAlerts(readFilters(query), readAlertStatus(query), readLimit(query));
  }

  // The latest stock movements.
  @Get('stock-movements')
  stockMovements(@Query() query: unknown): Promise<StockMovementList> {
    return this.dashboard.stockMovements(
      readFilters(query),
      readMovementType(query),
      readLimit(query),
    );
  }
}
