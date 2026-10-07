import type { QueryResult } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import type { LimitsEnv } from '../config/security-env.js';
import type { RedisClient } from '../redis/redis.tokens.js';
import { SalesDataVersion } from '../redis/sales-data-version.js';
import { RedisAnswerCache } from './answer-cache.js';

const SQL = 'SELECT sum(quantity) FROM stock_levels';
const SCHEMA = 'schema-1';

const LIMITS: LimitsEnv = {
  questionsPerMinute: 10,
  dailyTokenQuota: 200_000,
  loginAttemptsPerMinute: 5,
  maxInflightPerUser: 1,
  sqlCacheTtlSeconds: 3600,
  resultCacheTtlSeconds: 300,
};

function resultOf(total: number): QueryResult {
  return {
    columns: [{ name: 'total', type: 'int8' }],
    rows: [[String(total)]],
    rowCount: 1,
    truncated: false,
    durationMs: 1,
  };
}

// Just enough of Redis for the cache: strings in a Map.
class FakeRedis {
  readonly values = new Map<string, string>();
  failing = false;

  private check(): void {
    if (this.failing) {
      throw new Error('Redis is down');
    }
  }

  get(key: string): Promise<string | null> {
    this.check();
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.check();
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  incr(key: string): Promise<number> {
    this.check();
    const next = Number(this.values.get(key) ?? '0') + 1;
    this.values.set(key, String(next));
    return Promise.resolve(next);
  }
}

function setup(limits: Partial<LimitsEnv> = {}) {
  const redis = new FakeRedis();
  const client = redis as unknown as RedisClient;
  const dataVersion = new SalesDataVersion(client);
  const cache = new RedisAnswerCache(client, { ...LIMITS, ...limits }, dataVersion);
  return { redis, dataVersion, cache };
}

describe('cache of query results and the version of the data', () => {
  it('serves a stored result to the same query', async () => {
    const { cache } = setup();
    const first = await cache.lookupResult(SQL, SCHEMA);
    expect(first.cached).toBeUndefined();

    await first.store(resultOf(100));

    expect((await cache.lookupResult(SQL, SCHEMA)).cached).toEqual(resultOf(100));
    expect((await cache.lookupResult('SELECT 1', SCHEMA)).cached).toBeUndefined();
    expect((await cache.lookupResult(SQL, 'schema-2')).cached).toBeUndefined();
  });

  it('stops serving what was stored before the data changed', async () => {
    const { cache, dataVersion } = setup();
    await (await cache.lookupResult(SQL, SCHEMA)).store(resultOf(100));

    await dataVersion.bump();

    expect((await cache.lookupResult(SQL, SCHEMA)).cached).toBeUndefined();
  });

  // The query of a question was already running on the old data when the
  // registry wrote. Its result must not become the cached answer of the new data.
  it('never files a result computed before a write under the data after it', async () => {
    const { cache, dataVersion } = setup();
    const slot = await cache.lookupResult(SQL, SCHEMA);
    expect(slot.cached).toBeUndefined();

    await dataVersion.bump();
    await slot.store(resultOf(100));

    expect((await cache.lookupResult(SQL, SCHEMA)).cached).toBeUndefined();
  });

  it('does not cache at all with a TTL of zero', async () => {
    const { cache, redis } = setup({ resultCacheTtlSeconds: 0 });

    const slot = await cache.lookupResult(SQL, SCHEMA);
    await slot.store(resultOf(100));

    expect(redis.values.size).toBe(0);
    expect((await cache.lookupResult(SQL, SCHEMA)).cached).toBeUndefined();
  });

  it('works without the cache while Redis is down', async () => {
    const { cache, redis, dataVersion } = setup();
    redis.failing = true;

    const slot = await cache.lookupResult(SQL, SCHEMA);
    expect(slot.cached).toBeUndefined();
    await expect(slot.store(resultOf(100))).resolves.toBeUndefined();
    // The write of the registry stands even if the cache cannot be told.
    await expect(dataVersion.bump()).resolves.toBeUndefined();
  });
});
