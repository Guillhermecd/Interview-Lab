import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@interview-lab/shared';
import { DatabaseError, type Pool } from 'pg';
import { APP_POOL } from '../conversation/app-pool.js';

const UNIQUE_VIOLATION = '23505';
// The role that may use the registry (D-56). Granted only by the
// `db:promote-admin` command (D-58).
const ADMIN_ROLE = 'admin';

const USER_COLUMNS = 'id, email, name, role';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface UserWithPasswordRow extends UserRow {
  password_hash: string;
}

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

export class EmailInUseError extends Error {}

// What the user may do is decided here, from the role stored in the database,
// and sent to the client as a capability: the client never sees or tests roles.
function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    canManageCatalog: row.role === ADMIN_ROLE,
  };
}

@Injectable()
export class UserRepository {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  // A new account is always a viewer (the default of the column).
  async create(input: { email: string; name: string; passwordHash: string }): Promise<AuthUser> {
    try {
      const result = await this.pool.query<UserRow>(
        `INSERT INTO app.users (email, name, password_hash) VALUES ($1, $2, $3)
         RETURNING ${USER_COLUMNS}`,
        [input.email, input.name, input.passwordHash],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('INSERT INTO app.users returned no row');
      }
      return toAuthUser(row);
    } catch (error) {
      if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) {
        throw new EmailInUseError();
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const result = await this.pool.query<UserWithPasswordRow>(
      `SELECT ${USER_COLUMNS}, password_hash FROM app.users WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { ...toAuthUser(row), passwordHash: row.password_hash };
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const result = await this.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM app.users WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAuthUser(row);
  }
}
