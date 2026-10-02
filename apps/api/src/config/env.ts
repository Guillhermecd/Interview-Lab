import { InvalidEnvError, parseBoolean, parseInteger, requireValue } from './env-parsers.js';

const MIN_PORT = 1;
const MAX_PORT = 65_535;
const PORT_RANGE = { min: MIN_PORT, max: MAX_PORT };

const DEFAULT_PORT = 3000;
const DEFAULT_DB_PORT = 5432;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_QUERY_MAX_ROWS = 1000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 5000;
const DEFAULT_APP_TIMEOUT_MS = 7000;

const MAX_POOL_SIZE = 100;
const MAX_QUERY_ROWS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;

export interface DatabaseConnectionEnv {
  host: string;
  port: number;
  name: string;
}

// The API only ever receives the read-only credentials. Admin credentials are
// read by the database CLI alone (src/database/database-env.ts).
export interface ReadonlyDatabaseEnv extends DatabaseConnectionEnv {
  readonlyPassword: string;
  poolMax: number;
}

export interface QueryEnv {
  maxRows: number;
  // Enforced by PostgreSQL (statement_timeout).
  statementTimeoutMs: number;
  // Enforced by the API for the whole execution; the safety net if the database
  // timeout does not fire.
  appTimeoutMs: number;
  internalEndpointEnabled: boolean;
}

export interface AppEnv {
  port: number;
  database: ReadonlyDatabaseEnv;
  query: QueryEnv;
}

export function loadDatabaseConnectionEnv(source: NodeJS.ProcessEnv): DatabaseConnectionEnv {
  return {
    host: requireValue(source, 'DB_HOST'),
    port: parseInteger(source, 'DB_PORT', { defaultValue: DEFAULT_DB_PORT, ...PORT_RANGE }),
    name: requireValue(source, 'DB_NAME'),
  };
}

function loadQueryEnv(source: NodeJS.ProcessEnv): QueryEnv {
  const timeoutRange = { min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS };
  const query = {
    maxRows: parseInteger(source, 'QUERY_MAX_ROWS', {
      defaultValue: DEFAULT_QUERY_MAX_ROWS,
      min: 1,
      max: MAX_QUERY_ROWS,
    }),
    statementTimeoutMs: parseInteger(source, 'QUERY_STATEMENT_TIMEOUT_MS', {
      defaultValue: DEFAULT_STATEMENT_TIMEOUT_MS,
      ...timeoutRange,
    }),
    appTimeoutMs: parseInteger(source, 'QUERY_APP_TIMEOUT_MS', {
      defaultValue: DEFAULT_APP_TIMEOUT_MS,
      ...timeoutRange,
    }),
    internalEndpointEnabled: parseBoolean(source, 'INTERNAL_QUERY_ENDPOINT_ENABLED', false),
  };

  if (query.appTimeoutMs <= query.statementTimeoutMs) {
    throw new InvalidEnvError(
      'QUERY_APP_TIMEOUT_MS',
      'must be greater than QUERY_STATEMENT_TIMEOUT_MS',
    );
  }
  return query;
}

export function loadEnv(source: NodeJS.ProcessEnv): AppEnv {
  return {
    port: parseInteger(source, 'PORT', { defaultValue: DEFAULT_PORT, ...PORT_RANGE }),
    database: {
      ...loadDatabaseConnectionEnv(source),
      readonlyPassword: requireValue(source, 'DB_READONLY_PASSWORD'),
      poolMax: parseInteger(source, 'DB_POOL_MAX', {
        defaultValue: DEFAULT_POOL_MAX,
        min: 1,
        max: MAX_POOL_SIZE,
      }),
    },
    query: loadQueryEnv(source),
  };
}
