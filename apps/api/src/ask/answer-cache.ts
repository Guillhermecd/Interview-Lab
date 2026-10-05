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
  getResult(sql: string, schemaVersion: string): Promise<QueryResult | undefined>;
  setResult(sql: string, schemaVersion: string, result: QueryResult): Promise<void>;
}

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
  getResult(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  setResult(): Promise<void> {
    return Promise.resolve();
  }
}

// A key, or how to build one when building it needs Redis: the lookup then
// happens inside the same try as the read or write, and fails the same way.
type Key = string | (() => Promise<string>);

function resolveKey(key: Key): Promise<string> {
  return typeof key === 'string' ? Promise.resolve(key) : key();
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

  getResult(sql: string, schemaVersion: string): Promise<QueryResult | undefined> {
    return this.read<QueryResult>(
      () => this.resultKey(sql, schemaVersion),
      this.limits.resultCacheTtlSeconds,
    );
  }

  setResult(sql: string, schemaVersion: string, result: QueryResult): Promise<void> {
    return this.write(
      () => this.resultKey(sql, schemaVersion),
      result,
      this.limits.resultCacheTtlSeconds,
    );
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

  private async read<T>(key: Key, ttlSeconds: number): Promise<T | undefined> {
    if (ttlSeconds === 0) {
      return undefined;
    }
    try {
      const stored = await this.redis.get(await resolveKey(key));
      return stored === null ? undefined : (JSON.parse(stored) as T);
    } catch (error) {
      this.logger.warn(`Cache read failed (${describeErrorForLog(error)})`);
      return undefined;
    }
  }

  private async write(key: Key, value: unknown, ttlSeconds: number): Promise<void> {
    if (ttlSeconds === 0) {
      return;
    }
    try {
      await this.redis.set(await resolveKey(key), JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed (${describeErrorForLog(error)})`);
    }
  }
}
