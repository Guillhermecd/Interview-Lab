import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { AppDatabaseEnv } from '../config/env.js';
import { APP_ROLE } from '../database/roles.js';
import { describeErrorForLog } from '../query/query-error.js';

export const APP_POOL = Symbol('APP_POOL');

const CONNECTION_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 30_000;

// Pool for the application's own data (conversations, messages). It connects as
// app_rw, which cannot read the demonstration data; user-written SQL never runs
// here, only the fixed statements of the repositories.
export function createAppPool(database: AppDatabaseEnv): Pool {
  const pool = new Pool({
    host: database.host,
    port: database.port,
    database: database.name,
    user: APP_ROLE,
    password: database.appPassword,
    max: database.poolMax,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  });

  const logger = new Logger('AppPool');
  // Without a listener, an error on an idle connection would crash the process.
  pool.on('error', (error) => {
    logger.warn(`Idle connection failed (${describeErrorForLog(error)})`);
  });

  return pool;
}
