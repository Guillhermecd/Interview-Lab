import { Inject, Injectable, Logger } from '@nestjs/common';
import type { QueryResult } from '@interview-lab/shared';
import type { Pool, PoolClient, QueryArrayConfig } from 'pg';
import type { QueryEnv } from '../config/env.js';
import { columnTypeName } from './column-types.js';
import { describeErrorForLog, QueryExecutionError, translateDatabaseError } from './query-error.js';
import { QUERY_ENV, READONLY_POOL } from './query.tokens.js';

const CURSOR_NAME = 'query_result';

// The extended protocol accepts exactly one statement per message, so a
// "SELECT 1; DROP ..." payload is rejected by PostgreSQL itself, whatever the
// SQL guard decided. `queryMode` is supported by pg but missing from its types.
interface SingleStatementQuery extends QueryArrayConfig {
  queryMode: 'extended';
}

interface FetchedRows {
  columns: QueryResult['columns'];
  rows: unknown[][];
}

interface Session {
  backendPid: number;
  fetched: FetchedRows;
}

class AppTimeoutError extends Error {}

function singleStatement(text: string): SingleStatementQuery {
  return { text, rowMode: 'array', queryMode: 'extended' };
}

// Runs SQL that has already been validated. It adds the limits that do not
// depend on the SQL text: read-only transaction, database and application
// timeouts, and a cap on returned rows.
@Injectable()
export class QueryExecutor {
  private readonly logger = new Logger(QueryExecutor.name);

  constructor(
    @Inject(READONLY_POOL) private readonly pool: Pool,
    @Inject(QUERY_ENV) private readonly limits: QueryEnv,
  ) {}

  async execute(sql: string): Promise<QueryResult> {
    const startedAt = performance.now();
    const client = await this.connect();
    const session: Partial<Session> = {};

    try {
      const fetched = await this.withAppTimeout(this.runInTransaction(client, sql, session));
      client.release();
      return this.toResult(fetched, startedAt);
    } catch (error) {
      await this.discard(client, error, session.backendPid);
      throw this.translate(error);
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

  private async runInTransaction(
    client: PoolClient,
    sql: string,
    session: Partial<Session>,
  ): Promise<FetchedRows> {
    await client.query('BEGIN TRANSACTION READ ONLY');
    // SET LOCAL-equivalent: re-applied on every execution, so nothing a previous
    // query did to the session can lift the timeout.
    const setup = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid, set_config('statement_timeout', $1, true)",
      [String(this.limits.statementTimeoutMs)],
    );
    session.backendPid = setup.rows[0]?.pid;

    // A cursor lets the database stop producing rows at the limit instead of
    // sending the full result to be cut in memory. DECLARE also only accepts
    // SELECT/VALUES, so data-modifying statements fail to parse here.
    await client.query(singleStatement(`DECLARE ${CURSOR_NAME} NO SCROLL CURSOR FOR ${sql}`));
    const page = await client.query<unknown[]>(
      singleStatement(`FETCH FORWARD ${String(this.limits.maxRows + 1)} FROM ${CURSOR_NAME}`),
    );
    await client.query('ROLLBACK');

    return {
      columns: page.fields.map((field) => ({
        name: field.name,
        type: columnTypeName(field.dataTypeID),
      })),
      rows: page.rows,
    };
  }

  private async withAppTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new AppTimeoutError());
      }, this.limits.appTimeoutMs);
    });

    // If the timer wins, `work` still rejects later, when its connection is
    // destroyed. That outcome was already reported through the race.
    work.catch(() => undefined);

    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private toResult(fetched: FetchedRows, startedAt: number): QueryResult {
    const truncated = fetched.rows.length > this.limits.maxRows;
    const rows = truncated ? fetched.rows.slice(0, this.limits.maxRows) : fetched.rows;

    return {
      columns: fetched.columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  // After a failure the connection only goes back to the pool if the
  // transaction could be rolled back; otherwise it is destroyed.
  private async discard(client: PoolClient, error: unknown, backendPid?: number): Promise<void> {
    if (error instanceof AppTimeoutError) {
      this.cancelBackend(backendPid);
      client.release(true);
      return;
    }

    try {
      await client.query('ROLLBACK');
      client.release();
    } catch (rollbackError) {
      this.logger.warn(`Rollback failed (${describeErrorForLog(rollbackError)})`);
      client.release(true);
    }
  }

  // Closing the socket does not stop a running statement right away, so the
  // backend is cancelled explicitly. Best effort: statement_timeout still bounds it.
  private cancelBackend(backendPid?: number): void {
    if (backendPid === undefined) {
      return;
    }
    this.pool.query('SELECT pg_cancel_backend($1)', [backendPid]).catch((error: unknown) => {
      this.logger.warn(`Could not cancel a timed out query (${describeErrorForLog(error)})`);
    });
  }

  private translate(error: unknown): QueryExecutionError {
    if (error instanceof AppTimeoutError) {
      return new QueryExecutionError('QUERY_TIMEOUT');
    }
    const translated = translateDatabaseError(error);
    if (translated.code === 'QUERY_FAILED' || translated.code === 'DATABASE_UNAVAILABLE') {
      this.logger.error(`Query execution failed (${describeErrorForLog(error)})`);
    }
    return translated;
  }
}
