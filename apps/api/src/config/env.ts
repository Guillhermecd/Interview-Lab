import { InvalidEnvError, parseBoolean, parseInteger, requireValue } from './env-parsers.js';
import {
  loadAuthEnv,
  loadLimitsEnv,
  loadRedisEnv,
  type AuthEnv,
  type LimitsEnv,
  type RedisEnv,
} from './security-env.js';

const MIN_PORT = 1;
const MAX_PORT = 65_535;
const PORT_RANGE = { min: MIN_PORT, max: MAX_PORT };

const DEFAULT_PORT = 3000;
const DEFAULT_DB_PORT = 5432;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_QUERY_MAX_ROWS = 1000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 5000;
const DEFAULT_APP_TIMEOUT_MS = 7000;

const DEFAULT_LLM_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_LLM_TIMEOUT_MS = 30_000;
const MAX_LLM_TIMEOUT_MS = 120_000;
const DEFAULT_EXPLAIN_MAX_ROWS = 50;
const MAX_EXPLAIN_ROWS = 1000;

const DEFAULT_ON_TIME_TARGET_PERCENT = 95;
const MAX_PERCENT = 100;

const MAX_POOL_SIZE = 100;
const MAX_QUERY_ROWS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;

export interface DatabaseConnectionEnv {
  host: string;
  port: number;
  name: string;
}

// The API never receives the admin credentials: those are read by the
// database CLI alone (src/database/database-env.ts).
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

export interface LlmEnv {
  // Absent until a key is configured; the application still starts, and asking
  // a question reports that the LLM is not configured.
  geminiApiKey: string | undefined;
  model: string;
  timeoutMs: number;
  // Rows of a query result sent to the LLM to write the explanation.
  explainMaxRows: number;
}

// Credentials of app_rw, the role that owns the application data (conversations).
export interface AppDatabaseEnv extends DatabaseConnectionEnv {
  appPassword: string;
  poolMax: number;
}

export interface DashboardEnv {
  // Share of deliveries expected on time, shown as the target (D-55).
  onTimeTargetPercent: number;
}

export interface AppEnv {
  port: number;
  database: ReadonlyDatabaseEnv;
  appDatabase: AppDatabaseEnv;
  query: QueryEnv;
  llm: LlmEnv;
  auth: AuthEnv;
  redis: RedisEnv;
  limits: LimitsEnv;
  dashboard: DashboardEnv;
}

export function loadDatabaseConnectionEnv(source: NodeJS.ProcessEnv): DatabaseConnectionEnv {
  return {
    host: requireValue(source, 'DB_HOST'),
    port: parseInteger(source, 'DB_PORT', { defaultValue: DEFAULT_DB_PORT, ...PORT_RANGE }),
    name: requireValue(source, 'DB_NAME'),
  };
}

export function loadQueryEnv(source: NodeJS.ProcessEnv): QueryEnv {
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

function optionalValue(source: NodeJS.ProcessEnv, variable: string): string | undefined {
  const value = source[variable];
  return value === undefined || value === '' ? undefined : value;
}

export function loadLlmEnv(source: NodeJS.ProcessEnv): LlmEnv {
  return {
    geminiApiKey: optionalValue(source, 'GEMINI_API_KEY'),
    model: optionalValue(source, 'LLM_MODEL') ?? DEFAULT_LLM_MODEL,
    timeoutMs: parseInteger(source, 'LLM_TIMEOUT_MS', {
      defaultValue: DEFAULT_LLM_TIMEOUT_MS,
      min: MIN_TIMEOUT_MS,
      max: MAX_LLM_TIMEOUT_MS,
    }),
    explainMaxRows: parseInteger(source, 'LLM_EXPLAIN_MAX_ROWS', {
      defaultValue: DEFAULT_EXPLAIN_MAX_ROWS,
      min: 1,
      max: MAX_EXPLAIN_ROWS,
    }),
  };
}

export function loadDashboardEnv(source: NodeJS.ProcessEnv): DashboardEnv {
  return {
    onTimeTargetPercent: parseInteger(source, 'ON_TIME_DELIVERY_TARGET_PERCENT', {
      defaultValue: DEFAULT_ON_TIME_TARGET_PERCENT,
      min: 1,
      max: MAX_PERCENT,
    }),
  };
}

export function loadEnv(source: NodeJS.ProcessEnv): AppEnv {
  const connection = loadDatabaseConnectionEnv(source);
  const poolMax = parseInteger(source, 'DB_POOL_MAX', {
    defaultValue: DEFAULT_POOL_MAX,
    min: 1,
    max: MAX_POOL_SIZE,
  });

  return {
    port: parseInteger(source, 'PORT', { defaultValue: DEFAULT_PORT, ...PORT_RANGE }),
    database: {
      ...connection,
      readonlyPassword: requireValue(source, 'DB_READONLY_PASSWORD'),
      poolMax,
    },
    appDatabase: {
      ...connection,
      appPassword: requireValue(source, 'DB_APP_PASSWORD'),
      poolMax,
    },
    query: loadQueryEnv(source),
    llm: loadLlmEnv(source),
    auth: loadAuthEnv(source),
    redis: loadRedisEnv(source),
    limits: loadLimitsEnv(source),
    dashboard: loadDashboardEnv(source),
  };
}
