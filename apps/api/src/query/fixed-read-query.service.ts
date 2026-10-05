import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { QueryEnv } from '../config/env.js';
import { describeErrorForLog, QueryExecutionError, translateDatabaseError } from './query-error.js';
import { QUERY_ENV, READONLY_POOL } from './query.tokens.js';

// Runs statements WRITTEN IN THIS CODEBASE on the read-only pool, with their
// values passed as parameters (D-54). It exists for screens that read `sales`
// with fixed SQL, such as the dashboard.
//
// It does not go through the SQL guard, so it must never receive SQL text that
// came from a user or from the LLM: that text only runs through
// GuardedQueryService. The statement still runs as app_readonly, in a
// read-only transaction, under the same statement timeout as every query.
@Injectable()
export class FixedReadQuery {
  private readonly logger = new Logger(FixedReadQuery.name);

  constructor(
    @Inject(READONLY_POOL) private readonly pool: Pool,
    @Inject(QUERY_ENV) private readonly limits: QueryEnv,
  ) {}

  async rows<Row extends QueryResultRow>(
    statement: string,
    values: unknown[] = [],
  ): Promise<Row[]> {
    const client = await this.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(this.limits.statementTimeoutMs),
      ]);
      const result = await client.query<Row>(statement, values);
      await client.query('ROLLBACK');
      client.release();
      return result.rows;
    } catch (error) {
      await this.discard(client);
      const translated = translateDatabaseError(error);
      // The statement is ours: any failure other than a timeout is a defect.
      if (translated.code !== 'QUERY_TIMEOUT') {
        this.logger.error(`Fixed statement failed (${describeErrorForLog(error)})`);
      }
      throw translated;
    }
  }

  private async connect(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error) {
      this.logger.error(`Could not get a database connection (${describeErrorForLog(error)})`);
      throw new QueryExecutionError('DATABASE_UNAVAILABLE');
    }
  }

  // The connection only goes back to the pool if the transaction could be
  // rolled back; otherwise it is destroyed.
  private async discard(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
      client.release();
    } catch (rollbackError) {
      this.logger.warn(`Rollback failed (${describeErrorForLog(rollbackError)})`);
      client.release(true);
    }
  }
}
