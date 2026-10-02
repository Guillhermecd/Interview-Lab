import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { AppEnv } from '../../src/config/env.js';
import { seedDemoData } from '../../src/database/seed.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const EXECUTE_URL = '/api/internal/queries/execute';

async function startApp(env: AppEnv): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(env)],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('API over HTTP', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
    await migrateTestDatabase(database);
    await withClient(database.admin, seedDemoData);
  });

  afterAll(async () => {
    await database.stop();
  });

  describe('with the internal query endpoint enabled', () => {
    let app: NestFastifyApplication;

    function execute(payload: unknown) {
      return app.inject({ method: 'POST', url: EXECUTE_URL, payload: payload as object });
    }

    beforeAll(async () => {
      app = await startApp(database.appEnv({ internalEndpointEnabled: true, maxRows: 3 }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /api/health responds ok when the database answers', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('executes a query and returns the standard result', async () => {
      const response = await execute({ sql: 'SELECT name FROM regions ORDER BY name' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        columns: [{ name: 'name', type: 'text' }],
        rows: [['Centro-Oeste'], ['Nordeste'], ['Norte']],
        rowCount: 3,
        truncated: true,
        durationMs: expect.any(Number) as number,
      });
    });

    it('serializes timestamps as ISO 8601 in UTC', async () => {
      const response = await execute({
        sql: "SELECT timestamptz '2026-06-21 15:00:00-03' AS moment",
      });

      expect(response.json()).toMatchObject({ rows: [['2026-06-21T18:00:00.000Z']] });
    });

    it.each([
      ['a missing sql', {}],
      ['an empty sql', { sql: '   ' }],
      ['a non-string sql', { sql: 42 }],
      ['an oversized sql', { sql: `SELECT '${'x'.repeat(10_000)}'` }],
    ])('rejects %s with a validation error', async (_case, payload) => {
      const response = await execute(payload);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'sql', message: expect.any(String) as string }],
      });
    });

    it('returns a query error in the standard error format', async () => {
      const response = await execute({ sql: 'SELECT * FROM invoices' });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        code: 'QUERY_INVALID_REFERENCE',
        message: 'A consulta referencia uma tabela, coluna ou função que não existe.',
        details: [{ field: 'sql', message: 'relation "invoices" does not exist' }],
      });
    });

    it('returns 404 in the standard error format for an unknown route', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/unknown' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso não encontrado.' });
    });

    it.each([
      ['malformed JSON', { 'content-type': 'application/json' }, '{"sql": '],
      ['an unsupported content type', { 'content-type': 'text/plain' }, 'SELECT 1'],
      [
        'a body above the size limit',
        { 'content-type': 'application/json' },
        JSON.stringify({ sql: 'x'.repeat(2 * 1024 * 1024) }),
      ],
    ])('keeps the standard error format for %s', async (_case, headers, payload) => {
      const response = await app.inject({ method: 'POST', url: EXECUTE_URL, headers, payload });
      const body = response.json<Record<string, unknown>>();

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
      expect(body).toMatchObject({
        code: expect.any(String) as string,
        message: expect.any(String) as string,
      });
      // Fastify's own error shape must never reach the client.
      expect(body).not.toHaveProperty('statusCode');
      expect(body).not.toHaveProperty('error');
    });

    it('never exposes a stack trace', async () => {
      const response = await execute({ sql: 'SELECT name::int FROM regions' });

      expect(response.statusCode).toBe(422);
      expect(response.body).not.toContain('at ');
      expect(response.body).not.toContain('Norte');
    });
  });

  describe('with the default configuration', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await startApp(database.appEnv());
    });

    afterAll(async () => {
      await app.close();
    });

    it('does not register the internal query endpoint', async () => {
      const response = await app.inject({
        method: 'POST',
        url: EXECUTE_URL,
        payload: { sql: 'SELECT 1' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('when the database is unreachable', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      const env = database.appEnv();
      app = await startApp({
        ...env,
        database: { ...env.database, readonlyPassword: 'wrong-password' },
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /api/health responds 503 in the standard error format', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/health' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Serviço indisponível no momento.',
      });
    });
  });
});
