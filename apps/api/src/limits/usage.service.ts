import { Inject, Injectable } from '@nestjs/common';
import type { TokenUsage, UsageSummary } from '@interview-lab/shared';
import type { LimitsEnv } from '../config/security-env.js';
import { LimitError } from './limit-error.js';
import { RateLimiter } from './rate-limiter.js';
import { UsageRepository, type UsageKind } from './usage.repository.js';

export const LIMITS_ENV = Symbol('LIMITS_ENV');

const MILLISECONDS_PER_SECOND = 1000;

// The daily quota is counted per UTC day, so it resets at the next UTC midnight.
function secondsUntilUtcMidnight(now: Date): number {
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((nextMidnight - now.getTime()) / MILLISECONDS_PER_SECOND);
}

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
      throw new LimitError('QUOTA_EXCEEDED', secondsUntilUtcMidnight(new Date()));
    }
    await this.assertWithinRate(`llm:${userId}`, this.limits.questionsPerMinute);
  }

  async assertCanTryLogin(email: string): Promise<void> {
    await this.assertWithinRate(`login:${email}`, this.limits.loginAttemptsPerMinute);
  }

  private async assertWithinRate(key: string, limit: number): Promise<void> {
    const hit = await this.rateLimiter.tryHit(key, limit);
    if (!hit.allowed) {
      throw new LimitError('RATE_LIMITED', hit.retryAfterSeconds);
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
