import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READONLY_POOL } from './query.tokens.js';

// What the rest of the application may know about the database connection:
// whether it answers. The pool itself never leaves QueryModule, so no other
// module can run SQL around the guard.
@Injectable()
export class DatabaseHealth {
  constructor(@Inject(READONLY_POOL) private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}
