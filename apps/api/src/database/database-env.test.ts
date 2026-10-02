import { describe, expect, it } from 'vitest';
import { InvalidEnvError } from '../config/env-parsers.js';
import { loadDatabaseEnv } from './database-env.js';

const VALID_ENV = {
  DB_HOST: 'localhost',
  DB_PORT: '5433',
  DB_NAME: 'interview_lab',
  DB_ADMIN_USER: 'postgres',
  DB_ADMIN_PASSWORD: 'admin-secret',
  DB_READONLY_PASSWORD: 'readonly-secret',
  DB_APP_PASSWORD: 'app-secret',
};

describe('loadDatabaseEnv', () => {
  it('reads every database variable', () => {
    expect(loadDatabaseEnv(VALID_ENV)).toEqual({
      host: 'localhost',
      port: 5433,
      name: 'interview_lab',
      adminUser: 'postgres',
      adminPassword: 'admin-secret',
      readonlyPassword: 'readonly-secret',
      appPassword: 'app-secret',
    });
  });

  it('uses the default PostgreSQL port when DB_PORT is not set', () => {
    expect(loadDatabaseEnv({ ...VALID_ENV, DB_PORT: undefined }).port).toBe(5432);
  });

  it('rejects an invalid DB_PORT', () => {
    expect(() => loadDatabaseEnv({ ...VALID_ENV, DB_PORT: 'abc' })).toThrow(InvalidEnvError);
  });

  it.each([
    'DB_HOST',
    'DB_NAME',
    'DB_ADMIN_USER',
    'DB_ADMIN_PASSWORD',
    'DB_READONLY_PASSWORD',
    'DB_APP_PASSWORD',
  ])('rejects a missing %s', (variable) => {
    expect(() => loadDatabaseEnv({ ...VALID_ENV, [variable]: '' })).toThrow(InvalidEnvError);
  });
});
