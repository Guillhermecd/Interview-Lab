import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { ReadonlyDatabaseEnv } from '../config/env.js';
import { READONLY_ROLE } from '../database/roles.js';
import { describeErrorForLog } from './query-error.js';

const CONNECTION_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 30_000;

// The only pool the API uses to run queries. The user is fixed to the read-only
// role on purpose: no configuration can point it at a more privileged user.
export function createReadonlyPool(database: ReadonlyDatabaseEnv): Pool {
  const pool = new Pool({
    host: database.host,
    port: database.port,
    database: database.name,
    user: READONLY_ROLE,
    password: database.readonlyPassword,
    max: database.poolMax,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  });

  const logger = new Logger('ReadonlyPool');
  // Without a listener, an error on an idle connection would crash the process.
  pool.on('error', (error) => {
    logger.warn(`Idle connection failed (${describeErrorForLog(error)})`);
  });

  return pool;
}
