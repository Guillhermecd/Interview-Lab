import { Logger } from '@nestjs/common';
import { Pool, types } from 'pg';
import type { ReadonlyDatabaseEnv } from '../config/env.js';
import { READONLY_ROLE } from '../database/roles.js';
import { describeErrorForLog } from './query-error.js';

const CONNECTION_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 30_000;

// By default the driver turns DATE and TIMESTAMP (without time zone) into a
// JavaScript Date at local midnight/local time, so "2026-09-02" would reach the
// client as "2026-09-02T03:00:00.000Z". Neither type carries a time zone, so
// both are kept exactly as PostgreSQL prints them.
const TYPES_KEPT_AS_TEXT = [types.builtins.DATE, types.builtins.TIMESTAMP];

function keepText(value: string): string {
  return value;
}

// The pools the API uses to read `sales`: one for SQL that came from the LLM or
// from a user, one for statements written in the code. The user is fixed to the
// read-only role on purpose: no configuration can point either at a more
// privileged user.
export function createReadonlyPool(
  database: ReadonlyDatabaseEnv,
  max: number = database.poolMax,
): Pool {
  const pool = new Pool({
    host: database.host,
    port: database.port,
    database: database.name,
    user: READONLY_ROLE,
    password: database.readonlyPassword,
    max,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  });

  pool.on('connect', (client) => {
    for (const type of TYPES_KEPT_AS_TEXT) {
      client.setTypeParser(type, keepText);
    }
  });

  const logger = new Logger('ReadonlyPool');
  // Without a listener, an error on an idle connection would crash the process.
  pool.on('error', (error) => {
    logger.warn(`Idle connection failed (${describeErrorForLog(error)})`);
  });

  return pool;
}
