import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import type { AuthUser, UsageSummary } from '@interview-lab/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import { UsageService } from './usage.service.js';

@Controller('usage')
@UseGuards(AuthGuard)
export class UsageController {
  constructor(@Inject(UsageService) private readonly usage: UsageService) {}

  // Tokens spent today by the signed-in user, overall and per conversation.
  @Get()
  summary(@CurrentUser() user: AuthUser): Promise<UsageSummary> {
    return this.usage.summary(user.id);
  }
}
