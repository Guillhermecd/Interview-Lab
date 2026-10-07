import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LimitsEnv } from '../config/security-env.js';
import { describeErrorForLog } from '../query/query-error.js';
import { REDIS, type RedisClient } from '../redis/redis.tokens.js';
import { LimitError } from './limit-error.js';
import { LIMITS_ENV } from './limits.tokens.js';

// Longer than any single question can take: two SQL attempts and the
// explanation at the largest LLM timeout (120 s each), plus two queries at the
// largest application timeout (60 s each). If a process dies holding a slot,
// the slot is given back when this expires.
const SLOT_TTL_SECONDS = 600;
// Stopping an answer and asking again arrives here a moment before the slot of
// the stopped answer is released: one short wait covers that.
const BUSY_RETRY_DELAY_MS = 250;

// Counts one more execution, unless that passes the limit. One script, so a
// refused request never leaves its increment behind, and the counter is never
// left without an expiry.
const ACQUIRE_SCRIPT = `
local running = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
if running > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

// Never goes below zero, even if the counter expired meanwhile.
const RELEASE_SCRIPT = `
local running = tonumber(redis.call('GET', KEYS[1]) or '0')
if running > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function executionSlotKey(userId: string): string {
  return `inflight:${userId}`;
}

// How many questions and SQL executions one user has running right now
// (D-66). Kept in Redis, so the limit holds across instances of the API.
@Injectable()
export class ExecutionSlots {
  private readonly logger = new Logger(ExecutionSlots.name);

  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(LIMITS_ENV) private readonly limits: LimitsEnv,
  ) {}

  // Takes a slot or throws EXECUTION_IN_PROGRESS. The caller must call the
  // returned function when the work ends, whatever the outcome.
  async acquire(userId: string): Promise<() => Promise<void>> {
    const key = executionSlotKey(userId);
    if (!(await this.tryAcquire(key))) {
      await pause(BUSY_RETRY_DELAY_MS);
      if (!(await this.tryAcquire(key))) {
        throw new LimitError('EXECUTION_IN_PROGRESS');
      }
    }

    let released = false;
    return async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        await this.redis.eval(RELEASE_SCRIPT, 1, key);
      } catch (error) {
        // The slot comes back by itself when its key expires.
        this.logger.warn(`Could not release an execution slot (${describeErrorForLog(error)})`);
      }
    };
  }

  private async tryAcquire(key: string): Promise<boolean> {
    const acquired = await this.redis.eval(
      ACQUIRE_SCRIPT,
      1,
      key,
      String(this.limits.maxInflightPerUser),
      String(SLOT_TTL_SECONDS),
    );
    return acquired === 1;
  }
}
