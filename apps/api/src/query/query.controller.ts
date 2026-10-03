import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import type { QueryResult } from '@interview-lab/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { readSql } from '../http/request-readers.js';
import { GuardedQueryService } from './guarded-query.service.js';

// Internal endpoint for debugging the guard and the executor: requires a
// signed-in user and is registered only when INTERNAL_QUERY_ENDPOINT_ENABLED=true.
// It does not call the LLM, so no quota applies.
@Controller('internal/queries')
@UseGuards(AuthGuard)
export class QueryController {
  constructor(@Inject(GuardedQueryService) private readonly queries: GuardedQueryService) {}

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  execute(@Body() body: unknown): Promise<QueryResult> {
    return this.queries.run(readSql(body));
  }
}
