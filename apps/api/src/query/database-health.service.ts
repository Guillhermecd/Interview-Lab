import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { FIXED_READ_POOL } from './query.tokens.js';

// What the rest of the application may know about the database connection:
// whether it answers. It asks through the pool of fixed statements, so slow
// questions in the chat do not make the application look down. The pool itself never leaves QueryModule, so no other
// module can run SQL around the guard.
@Injectable()
export class DatabaseHealth {
  constructor(@Inject(FIXED_READ_POOL) private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}
