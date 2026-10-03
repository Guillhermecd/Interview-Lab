import { Inject, Injectable } from '@nestjs/common';
import type { QueryResult } from '@interview-lab/shared';
import { SqlGuardError } from '../sql-guard/sql-guard-error.js';
import type { SqlGuard } from '../sql-guard/sql-guard.js';
import { QueryExecutionError } from './query-error.js';
import { QueryExecutor } from './query-executor.service.js';
import { SQL_GUARD } from './query.tokens.js';

// The only way to run SQL in the application: every query, whether written by
// the LLM or edited by a user, goes through the SQL guard before the executor.
// QueryExecutor is deliberately not exported from QueryModule.
@Injectable()
export class GuardedQueryService {
  constructor(
    @Inject(SQL_GUARD) private readonly guard: SqlGuard,
    @Inject(QueryExecutor) private readonly executor: QueryExecutor,
  ) {}

  // async, so a guard rejection is a rejected promise like any execution error.
  async run(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    // What runs is the text returned by the guard, never the original input.
    return this.executor.execute(this.validate(sql), signal);
  }

  // Runs only the guard, without executing: used to check SQL that will be
  // shown to the user for review. Throws the same errors as run().
  check(sql: string): void {
    this.validate(sql);
  }

  private validate(sql: string): string {
    try {
      return this.guard.validate(sql).sql;
    } catch (error) {
      if (error instanceof SqlGuardError) {
        const code = error.rule === 'SYNTAX_ERROR' ? 'QUERY_SYNTAX_ERROR' : 'QUERY_REJECTED';
        throw new QueryExecutionError(code, [{ field: 'sql', message: error.message }]);
      }
      throw error;
    }
  }
}
