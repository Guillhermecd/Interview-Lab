import { Inject, Logger, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { RedisEnv } from '../config/security-env.js';
import { describeErrorForLog } from '../query/query-error.js';

export const REDIS = Symbol('REDIS');

// The commands this application uses. Depending on this instead of the whole
// client keeps the Redis-backed classes easy to test.
export type RedisClient = Pick<Redis, 'get' | 'set' | 'del' | 'multi' | 'quit'>;

export function createRedis(env: RedisEnv): Redis {
  // Connects on first use, so the API still starts (and its health check
  // answers) while Redis is down; commands then fail and are reported.
  const client = new Redis(env.url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  const logger = new Logger('Redis');
  client.on('error', (error: unknown) => {
    logger.warn(`Redis connection error (${describeErrorForLog(error)})`);
  });
  return client;
}

// Rate limit and cache storage (D-07b).
@Module({})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly client: Redis) {}

  static register(env: RedisEnv): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      providers: [{ provide: REDIS, useFactory: () => createRedis(env) }],
      exports: [REDIS],
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'ready' || this.client.status === 'connecting') {
      await this.client.quit();
    } else {
      this.client.disconnect();
    }
  }
}
