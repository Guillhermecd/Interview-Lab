import type { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

// The commands this application uses. Depending on this instead of the whole
// client keeps the Redis-backed classes easy to test.
export type RedisClient = Pick<Redis, 'get' | 'set' | 'del' | 'incr' | 'multi' | 'eval' | 'quit'>;
