import { Inject, Injectable } from '@nestjs/common';
import type { TokenUsage, UsageSummary } from '@interview-lab/shared';
import type { LimitsEnv } from '../config/security-env.js';
import { LimitError } from './limit-error.js';
import { RateLimiter } from './rate-limiter.js';
import { UsageRepository, type UsageKind } from './usage.repository.js';

export const LIMITS_ENV = Symbol('LIMITS_ENV');

// Rule 7: rate limit and daily quota are checked before any call to the LLM.
@Injectable()
export class UsageService {
  constructor(
    @Inject(RateLimiter) private readonly rateLimiter: RateLimiter,
    @Inject(UsageRepository) private readonly usage: UsageRepository,
    @Inject(LIMITS_ENV) private readonly limits: LimitsEnv,
  ) {}

  // Call before starting anything that talks to the LLM. The quota is checked
  // first, so a refused request does not consume the per-minute allowance.
  async assertCanUseLlm(userId: string): Promise<void> {
    const today = await this.usage.todayTotal(userId);
    if (today.inputTokens + today.outputTokens >= this.limits.dailyTokenQuota) {
      throw new LimitError('QUOTA_EXCEEDED');
    }
    if (!(await this.rateLimiter.tryHit(`llm:${userId}`, this.limits.questionsPerMinute))) {
      throw new LimitError('RATE_LIMITED');
    }
  }

  async assertCanTryLogin(email: string): Promise<void> {
    if (!(await this.rateLimiter.tryHit(`login:${email}`, this.limits.loginAttemptsPerMinute))) {
      throw new LimitError('RATE_LIMITED');
    }
  }

  record(
    userId: string,
    conversationId: string | undefined,
    kind: UsageKind,
    usage: TokenUsage,
  ): Promise<void> {
    return this.usage.record(userId, conversationId, kind, usage);
  }

  async summary(userId: string): Promise<UsageSummary> {
    const [today, byConversation] = await Promise.all([
      this.usage.todayTotal(userId),
      this.usage.todayByConversation(userId),
    ]);
    return {
      today,
      dailyTokenQuota: this.limits.dailyTokenQuota,
      questionsPerMinute: this.limits.questionsPerMinute,
      byConversation,
    };
  }
}
