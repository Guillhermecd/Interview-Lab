import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { QueryResult } from '@interview-lab/shared';
import type { LimitsEnv } from '../config/security-env.js';
import { LIMITS_ENV } from '../limits/usage.service.js';
import { describeErrorForLog } from '../query/query-error.js';
import { REDIS, type RedisClient } from '../redis/redis.module.js';
import { SalesDataVersion } from '../redis/sales-data-version.js';
import type { ProposedVisualization } from './llm-output.js';

export const ANSWER_CACHE = Symbol('ANSWER_CACHE');

export interface CachedSql {
  sql: string;
  proposedVisualization: ProposedVisualization;
}

// Cache of repeated questions (D-07b). Every key includes the schema version,
// so a schema change makes all previous entries unreachable at once.
export interface AnswerCache {
  getSql(question: string, schemaVersion: string): Promise<CachedSql | undefined>;
  setSql(question: string, schemaVersion: string, value: CachedSql): Promise<void>;
  deleteSql(question: string, schemaVersion: string): Promise<void>;
  // Looks a result up and says how to store one under the same key. The key
  // is fixed before the query runs: see ResultSlot.
  lookupResult(sql: string, schemaVersion: string): Promise<ResultSlot>;
}

// The place of one query result in the cache. `store` writes under the key the
// lookup used, whatever happened in between: if the registry changed the data
// while the query ran, the result lands under the old data version, where no
// later question looks, instead of being served as if it were fresh.
export interface ResultSlot {
  cached: QueryResult | undefined;
  store: (result: QueryResult) => Promise<void>;
}

const NO_SLOT: ResultSlot = { cached: undefined, store: () => Promise.resolve() };

// "Qual o faturamento por região?" and "qual o  faturamento por região" are
// the same question.
export function normalizeQuestion(question: string): string {
  return question
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\s?!.]+$/u, '');
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Used where caching is not wanted (tests, the evaluation script).
export class NoAnswerCache implements AnswerCache {
  getSql(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  setSql(): Promise<void> {
    return Promise.resolve();
  }
  deleteSql(): Promise<void> {
    return Promise.resolve();
  }
  lookupResult(): Promise<ResultSlot> {
    return Promise.resolve(NO_SLOT);
  }
}

// Best effort: if Redis fails, the answer is produced without the cache and the
// failure is only logged. A TTL of 0 disables that part of the cache.
@Injectable()
export class RedisAnswerCache implements AnswerCache {
  private readonly logger = new Logger(RedisAnswerCache.name);

  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(LIMITS_ENV) private readonly limits: LimitsEnv,
    @Inject(SalesDataVersion) private readonly dataVersion: Pick<SalesDataVersion, 'current'>,
  ) {}

  getSql(question: string, schemaVersion: string): Promise<CachedSql | undefined> {
    return this.read<CachedSql>(
      this.sqlKey(question, schemaVersion),
      this.limits.sqlCacheTtlSeconds,
    );
  }

  setSql(question: string, schemaVersion: string, value: CachedSql): Promise<void> {
    return this.write(this.sqlKey(question, schemaVersion), value, this.limits.sqlCacheTtlSeconds);
  }

  async deleteSql(question: string, schemaVersion: string): Promise<void> {
    try {
      await this.redis.del(this.sqlKey(question, schemaVersion));
    } catch (error) {
      this.logger.warn(`Cache delete failed (${describeErrorForLog(error)})`);
    }
  }

  async lookupResult(sql: string, schemaVersion: string): Promise<ResultSlot> {
    const ttlSeconds = this.limits.resultCacheTtlSeconds;
    if (ttlSeconds === 0) {
      return NO_SLOT;
    }
    let key: string;
    try {
      // Read once, before the query: the same key serves the lookup and the store.
      key = await this.resultKey(sql, schemaVersion);
    } catch (error) {
      this.logger.warn(`Cache read failed (${describeErrorForLog(error)})`);
      return NO_SLOT;
    }
    return {
      cached: await this.read<QueryResult>(key, ttlSeconds),
      store: (result) => this.write(key, result, ttlSeconds),
    };
  }

  private sqlKey(question: string, schemaVersion: string): string {
    return `cache:sql:${schemaVersion}:${digest(normalizeQuestion(question))}`;
  }

  // Results also carry the version of the data: a write through the registry
  // changes it, and what was cached before is not served again (D-56).
  private async resultKey(sql: string, schemaVersion: string): Promise<string> {
    const dataVersion = await this.dataVersion.current();
    return `cache:result:${schemaVersion}:${dataVersion}:${digest(sql.trim())}`;
  }

  private async read<T>(key: string, ttlSeconds: number): Promise<T | undefined> {
    if (ttlSeconds === 0) {
      return undefined;
    }
    try {
      const stored = await this.redis.get(key);
      return stored === null ? undefined : (JSON.parse(stored) as T);
    } catch (error) {
      this.logger.warn(`Cache read failed (${describeErrorForLog(error)})`);
      return undefined;
    }
  }

  private async write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (ttlSeconds === 0) {
      return;
    }
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed (${describeErrorForLog(error)})`);
    }
  }
}
