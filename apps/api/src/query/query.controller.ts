import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import type { QueryResult } from '@interview-lab/shared';
import { readSql } from '../http/request-readers.js';
import { GuardedQueryService } from './guarded-query.service.js';

// Internal endpoint: the SQL goes through the guard, but there is no
// authentication or rate limit yet (Phase 08). It is registered only when
// INTERNAL_QUERY_ENDPOINT_ENABLED=true.
@Controller('internal/queries')
export class QueryController {
  constructor(@Inject(GuardedQueryService) private readonly queries: GuardedQueryService) {}

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  execute(@Body() body: unknown): Promise<QueryResult> {
    return this.queries.run(readSql(body));
  }
}
