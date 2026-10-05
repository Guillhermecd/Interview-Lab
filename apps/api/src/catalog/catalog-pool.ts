import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { CatalogDatabaseEnv } from '../config/env.js';
import { CATALOG_ROLE } from '../database/roles.js';
import { describeErrorForLog } from '../query/query-error.js';

export const CATALOG_POOL = Symbol('CATALOG_POOL');

const CONNECTION_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 30_000;

// The only pool that can write to `sales`, and only to products and stock
// (D-56). It connects as app_catalog_rw and never leaves CatalogModule: the
// chat, the LLM and every other module keep running as app_readonly or app_rw.
// Only the fixed statements of CatalogRepository run here.
export function createCatalogPool(database: CatalogDatabaseEnv): Pool {
  const pool = new Pool({
    host: database.host,
    port: database.port,
    database: database.name,
    user: CATALOG_ROLE,
    password: database.catalogPassword,
    max: database.poolMax,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  });

  const logger = new Logger('CatalogPool');
  // Without a listener, an error on an idle connection would crash the process.
  pool.on('error', (error) => {
    logger.warn(`Idle connection failed (${describeErrorForLog(error)})`);
  });

  return pool;
}
