import { requireValue } from '../config/env-parsers.js';
import { loadDatabaseConnectionEnv, type DatabaseConnectionEnv } from '../config/env.js';

// Read only by the database CLI (migrations, provisioning, seed). The running
// API never loads the admin credentials.
export interface DatabaseEnv extends DatabaseConnectionEnv {
  adminUser: string;
  adminPassword: string;
  readonlyPassword: string;
  appPassword: string;
}

export function loadDatabaseEnv(source: NodeJS.ProcessEnv): DatabaseEnv {
  return {
    ...loadDatabaseConnectionEnv(source),
    adminUser: requireValue(source, 'DB_ADMIN_USER'),
    adminPassword: requireValue(source, 'DB_ADMIN_PASSWORD'),
    readonlyPassword: requireValue(source, 'DB_READONLY_PASSWORD'),
    appPassword: requireValue(source, 'DB_APP_PASSWORD'),
  };
}
