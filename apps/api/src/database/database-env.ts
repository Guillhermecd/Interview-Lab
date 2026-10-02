import { InvalidEnvError } from '../config/env.js';

const DEFAULT_DB_PORT = 5432;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

export interface DatabaseEnv {
  host: string;
  port: number;
  name: string;
  adminUser: string;
  adminPassword: string;
  readonlyPassword: string;
  appPassword: string;
}

function requireValue(source: NodeJS.ProcessEnv, variable: string): string {
  const value = source[variable];
  if (value === undefined || value === '') {
    throw new InvalidEnvError(variable, 'is required');
  }
  return value;
}

function parseDatabasePort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort === '') {
    return DEFAULT_DB_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new InvalidEnvError(
      'DB_PORT',
      `expected an integer between ${String(MIN_PORT)} and ${String(MAX_PORT)}`,
    );
  }
  return port;
}

export function loadDatabaseEnv(source: NodeJS.ProcessEnv): DatabaseEnv {
  return {
    host: requireValue(source, 'DB_HOST'),
    port: parseDatabasePort(source.DB_PORT),
    name: requireValue(source, 'DB_NAME'),
    adminUser: requireValue(source, 'DB_ADMIN_USER'),
    adminPassword: requireValue(source, 'DB_ADMIN_PASSWORD'),
    readonlyPassword: requireValue(source, 'DB_READONLY_PASSWORD'),
    appPassword: requireValue(source, 'DB_APP_PASSWORD'),
  };
}
