import { Inject, Injectable } from '@nestjs/common';
import { REDIS, type RedisClient } from '../redis/redis.module.js';

const WINDOW_SECONDS = 60;

// Fixed one-minute window per key (D-37): INCR and EXPIRE in one MULTI, so the
// counter can never be left without an expiry.
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  // Counts one hit; true while the key is within `limit` hits this minute.
  async tryHit(key: string, limit: number): Promise<boolean> {
    const windowKey = `rate:${key}:${String(Math.floor(Date.now() / 1000 / WINDOW_SECONDS))}`;
    const results = await this.redis
      .multi()
      .incr(windowKey)
      .expire(windowKey, WINDOW_SECONDS)
      .exec();
    const count = results?.[0]?.[1];
    if (typeof count !== 'number') {
      throw new Error('Unexpected reply from Redis INCR');
    }
    return count <= limit;
  }
}
