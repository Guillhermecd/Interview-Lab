import { Inject, Injectable, Logger } from '@nestjs/common';
import type { QueryResult } from '@interview-lab/shared';
import type { Pool, PoolClient, QueryArrayConfig } from 'pg';
import type { QueryEnv } from '../config/env.js';
import { columnTypeName } from './column-types.js';
import { assessPlan } from './plan-cost.js';
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
}

class AppTimeoutError extends Error {}
class AbortedError extends Error {}

type Interruption = AppTimeoutError | AbortedError;

function isInterruption(error: unknown): error is Interruption {
  return error instanceof AppTimeoutError || error instanceof AbortedError;
}

function singleStatement(text: string): SingleStatementQuery {
  return { text, rowMode: 'array', queryMode: 'extended' };
}

// Runs SQL that has already been validated. It adds the limits that do not
// depend on the SQL text: read-only transaction, database and application
// timeouts, a cap on returned rows, and a refusal of plans estimated as too
// expensive (D-65).
@Injectable()
export class QueryExecutor {
  private readonly logger = new Logger(QueryExecutor.name);

  constructor(
    @Inject(READONLY_POOL) private readonly pool: Pool,
    @Inject(QUERY_ENV) private readonly limits: QueryEnv,
  ) {}

  // `signal` lets the caller give up (for example when the HTTP client
  // disconnects): the running statement is cancelled in the database.
  async execute(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    if (signal?.aborted === true) {
      throw new QueryExecutionError('QUERY_CANCELLED');
    }
    const startedAt = performance.now();
    const fetched = await this.inTransaction(signal, async (client) => {
      await this.declare(client, sql);
      await this.assertAffordable(client, sql);
      return this.fetch(client);
    });
    return this.toResult(fetched, startedAt);
  }

  // Only asks the database how it would run the query, and refuses it when the
  // plan is too expensive, exactly as execute() would before running. Returns
  // the estimated cost. For SQL that is checked now and run later (review mode).
  async estimateCost(sql: string, signal?: AbortSignal): Promise<number> {
    if (signal?.aborted === true) {
      throw new QueryExecutionError('QUERY_CANCELLED');
    }
    return this.inTransaction(signal, async (client) => {
      await this.declare(client, sql);
      return this.assertAffordable(client, sql);
    });
  }

  // Runs `work` in a read-only transaction under both timeouts, and gives the
  // connection back (or destroys it) whatever happens.
  private async inTransaction<T>(
    signal: AbortSignal | undefined,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.connect();
    const session: Partial<Session> = {};

    try {
      const outcome = await this.withInterruption(this.transact(client, session, work), signal);
      client.release();
      return outcome;
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

  private async transact<T>(
    client: PoolClient,
    session: Partial<Session>,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    await this.begin(client, session);
    const outcome = await work(client);
    await client.query('ROLLBACK');
    return outcome;
  }

  private async begin(client: PoolClient, session: Partial<Session>): Promise<void> {
    await client.query('BEGIN TRANSACTION READ ONLY');
    // SET LOCAL-equivalent: re-applied on every execution, so nothing a previous
    // query did to the session can lift the timeout.
    const setup = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid, set_config('statement_timeout', $1, true)",
      [String(this.limits.statementTimeoutMs)],
    );
    session.backendPid = setup.rows[0]?.pid;
  }

  // EXPLAIN without ANALYZE: the query is planned, never run. The user cannot
  // ask for it (the guard refuses EXPLAIN); only this code does.
  private async assertAffordable(client: PoolClient, sql: string): Promise<number> {
    const explained = await client.query<unknown[]>(
      singleStatement(`EXPLAIN (FORMAT JSON) ${sql}`),
    );
    const verdict = assessPlan(explained.rows[0]?.[0], { maxCost: this.limits.maxCost });
    if (verdict.refusal !== undefined) {
      throw new QueryExecutionError('QUERY_REJECTED', [{ field: 'sql', message: verdict.refusal }]);
    }
    return verdict.totalCost;
  }

  // A cursor lets the database stop producing rows at the limit instead of
  // sending the full result to be cut in memory. DECLARE also only accepts
  // SELECT/VALUES, so data-modifying statements fail to parse here, before
  // anything else looks at them. Nothing runs until the first FETCH.
  private async declare(client: PoolClient, sql: string): Promise<void> {
    await client.query(singleStatement(`DECLARE ${CURSOR_NAME} NO SCROLL CURSOR FOR ${sql}`));
  }

  private async fetch(client: PoolClient): Promise<FetchedRows> {
    const page = await client.query<unknown[]>(
      singleStatement(`FETCH FORWARD ${String(this.limits.maxRows + 1)} FROM ${CURSOR_NAME}`),
    );

    return {
      columns: page.fields.map((field) => ({
        name: field.name,
        type: columnTypeName(field.dataTypeID),
      })),
      rows: page.rows,
    };
  }

  // Resolves with the work, or rejects as soon as the application timeout
  // fires or the caller aborts.
  private async withInterruption<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new AppTimeoutError());
      }, this.limits.appTimeoutMs);
      onAbort = () => {
        reject(new AbortedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    // If the interruption wins, `work` still rejects later, when its connection
    // is destroyed. That outcome was already reported through the race.
    work.catch(() => undefined);

    try {
      return await Promise.race([work, interruption]);
    } finally {
      clearTimeout(timer);
      if (onAbort) {
        signal?.removeEventListener('abort', onAbort);
      }
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
    if (isInterruption(error)) {
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
      this.logger.warn(`Could not cancel an interrupted query (${describeErrorForLog(error)})`);
    });
  }

  private translate(error: unknown): QueryExecutionError {
    if (error instanceof AppTimeoutError) {
      return new QueryExecutionError('QUERY_TIMEOUT');
    }
    if (error instanceof AbortedError) {
      return new QueryExecutionError('QUERY_CANCELLED');
    }
    const translated = translateDatabaseError(error);
    if (translated.code === 'QUERY_FAILED' || translated.code === 'DATABASE_UNAVAILABLE') {
      this.logger.error(`Query execution failed (${describeErrorForLog(error)})`);
    }
    return translated;
  }
}
