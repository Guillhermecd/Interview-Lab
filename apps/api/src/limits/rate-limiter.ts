import { Inject, Injectable } from '@nestjs/common';
import { REDIS, type RedisClient } from '../redis/redis.module.js';

const WINDOW_SECONDS = 60;
const MILLISECONDS_PER_SECOND = 1000;

export interface RateLimitHit {
  allowed: boolean;
  // Seconds until the current window ends and the counter starts again.
  retryAfterSeconds: number;
}

// Fixed one-minute window per key (D-37): INCR and EXPIRE in one MULTI, so the
// counter can never be left without an expiry.
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  // Counts one hit; allowed while the key is within `limit` hits this minute.
  async tryHit(key: string, limit: number): Promise<RateLimitHit> {
    const nowSeconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
    const windowKey = `rate:${key}:${String(Math.floor(nowSeconds / WINDOW_SECONDS))}`;
    const results = await this.redis
      .multi()
      .incr(windowKey)
      .expire(windowKey, WINDOW_SECONDS)
      .exec();
    const count = results?.[0]?.[1];
    if (typeof count !== 'number') {
      throw new Error('Unexpected reply from Redis INCR');
    }
    return {
      allowed: count <= limit,
      retryAfterSeconds: WINDOW_SECONDS - (nowSeconds % WINDOW_SECONDS),
    };
  }
}
