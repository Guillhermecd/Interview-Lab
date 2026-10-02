import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import type { QueryResult } from '@interview-lab/shared';
import { ValidationError } from '../http/validation-error.js';
import { GuardedQueryService } from './guarded-query.service.js';

const MAX_SQL_LENGTH = 10_000;

function readSql(body: unknown): string {
  const sql = typeof body === 'object' && body !== null && 'sql' in body ? body.sql : undefined;

  if (typeof sql !== 'string' || sql.trim() === '') {
    throw new ValidationError([{ field: 'sql', message: 'Informe a consulta SQL.' }]);
  }
  if (sql.length > MAX_SQL_LENGTH) {
    throw new ValidationError([
      {
        field: 'sql',
        message: `A consulta SQL pode ter no máximo ${String(MAX_SQL_LENGTH)} caracteres.`,
      },
    ]);
  }
  return sql;
}

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
