import { Inject, Injectable, Logger } from '@nestjs/common';
import { describeErrorForLog } from '../query/query-error.js';
import { REDIS, type RedisClient } from './redis.tokens.js';

const VERSION_KEY = 'cache:sales-data-version';
const INITIAL_VERSION = '0';

// A counter that changes whenever the registry writes to `sales` (D-56). It is
// part of the key of every cached query result, so a result computed before a
// write is never served after it. Nothing is scanned or deleted: old entries
// simply stop being reachable and expire by their TTL.
@Injectable()
export class SalesDataVersion {
  private readonly logger = new Logger(SalesDataVersion.name);

  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async current(): Promise<string> {
    return (await this.redis.get(VERSION_KEY)) ?? INITIAL_VERSION;
  }

  // Best effort: the write to the database already happened and stands. If
  // Redis is down, cached results may live until their TTL (minutes).
  async bump(): Promise<void> {
    try {
      await this.redis.incr(VERSION_KEY);
    } catch (error) {
      this.logger.warn(`Could not invalidate cached results (${describeErrorForLog(error)})`);
    }
  }
}
