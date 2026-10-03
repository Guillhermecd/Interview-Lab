import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@interview-lab/shared';
import { DatabaseError, type Pool } from 'pg';
import { APP_POOL } from '../conversation/app-pool.js';

const UNIQUE_VIOLATION = '23505';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

export class EmailInUseError extends Error {}

function toUser(row: UserRow): StoredUser {
  return { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash };
}

@Injectable()
export class UserRepository {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async create(input: { email: string; name: string; passwordHash: string }): Promise<AuthUser> {
    try {
      const result = await this.pool.query<UserRow>(
        `INSERT INTO app.users (email, name, password_hash) VALUES ($1, $2, $3)
         RETURNING id, email, name, password_hash`,
        [input.email, input.name, input.passwordHash],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('INSERT INTO app.users returned no row');
      }
      return { id: row.id, email: row.email, name: row.name };
    } catch (error) {
      if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) {
        throw new EmailInUseError();
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const result = await this.pool.query<UserRow>(
      'SELECT id, email, name, password_hash FROM app.users WHERE email = $1',
      [email],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toUser(row);
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const result = await this.pool.query<Omit<UserRow, 'password_hash'>>(
      'SELECT id, email, name FROM app.users WHERE id = $1',
      [id],
    );
    return result.rows[0];
  }
}
