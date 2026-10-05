import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import type { SchemaOverview } from '@interview-lab/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { SchemaCatalog } from './schema-catalog.service.js';

// What the AI can read: the exposed tables and their columns, for the schema
// panel of the chat (D-41). Nothing outside the allowlist of the SQL guard is
// ever listed.
@Controller('schema')
@UseGuards(AuthGuard)
export class SchemaController {
  constructor(@Inject(SchemaCatalog) private readonly catalog: SchemaCatalog) {}

  @Get()
  overview(): Promise<SchemaOverview> {
    return this.catalog.overview();
  }
}
