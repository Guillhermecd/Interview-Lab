import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Conversation, UsageSummary } from '@interview-lab/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { LimitsEnv } from '../../src/config/security-env.js';
import { seedDemoData } from '../../src/database/seed.js';
import { LLM_PROVIDER } from '../../src/llm/llm-provider.js';
import { ScriptedLlmProvider, sqlAnswer } from '../support/scripted-llm-provider.js';
import { TEST_PASSWORD } from '../support/session.js';
import { parseSseBody } from '../support/sse-client.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  TEST_ALLOWED_ORIGIN,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const SESSION_COOKIE = 'interview_lab_session';
const REGION_COUNT_SQL = 'SELECT count(*) AS regioes FROM regions';

const RATE_WINDOW_MS = 60_000;
const WINDOW_SAFETY_MARGIN_MS = 15_000;

// The rate limit counts per fixed one-minute window (D-37). A test that makes
// several requests waits, if needed, for a fresh window, so the count is not
// reset halfway through.
async function waitForFreshRateWindow(): Promise<void> {
  const elapsed = Date.now() % RATE_WINDOW_MS;
  if (elapsed > RATE_WINDOW_MS - WINDOW_SAFETY_MARGIN_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_WINDOW_MS - elapsed + 100));
  }
}

// Phase 08: authentication, CSRF, ownership, limits and cache. HTTP, PostgreSQL
// and Redis are real; the LLM is scripted.
describe('security over HTTP', () => {
  let database: TestDatabase;
  const apps: NestFastifyApplication[] = [];
  let accounts = 0;

  async function startApp(
    provider = new ScriptedLlmProvider([]),
    limits: Partial<LimitsEnv> = {},
  ): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(database.appEnv({}, { limits }))],
    })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    apps.push(app);
    return app;
  }

  function newEmail(): string {
    accounts += 1;
    return `conta${String(accounts)}@example.com`;
  }

  async function register(app: NestFastifyApplication, email = newEmail()) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Pessoa', email, password: TEST_PASSWORD },
    });
    const cookie = response.cookies.find((item) => item.name === SESSION_COOKIE);
    return { response, email, cookie: cookie ? `${cookie.name}=${cookie.value}` : '' };
  }

  function as(cookie: string) {
    return { cookie };
  }

  async function createConversation(app: NestFastifyApplication, cookie: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: as(cookie),
    });
    return response.json<Conversation>();
  }

  function ask(
    app: NestFastifyApplication,
    cookie: string,
    conversationId: string,
    question: string,
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/messages`,
      headers: as(cookie),
      payload: { question },
    });
  }

  beforeAll(async () => {
    database = await startTestDatabase({ redis: true });
    await migrateTestDatabase(database);
    await withClient(database.admin, seedDemoData);
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  afterAll(async () => {
    await database.stop();
  });

  describe('registration and login', () => {
    it('creates the account and opens a session in an HttpOnly, SameSite=Strict cookie', async () => {
      const app = await startApp();
      const email = newEmail();

      const { response } = await register(app, email);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ id: expect.any(String) as string, email, name: 'Pessoa' });
      const cookie = response.cookies.find((item) => item.name === SESSION_COOKIE);
      expect(cookie).toMatchObject({
        httpOnly: true,
        sameSite: 'Strict',
        path: '/api',
        maxAge: 3600,
      });
      expect(cookie?.secure).toBeFalsy();
      expect(response.body).not.toContain(cookie?.value ?? 'no-cookie');
    });

    it('stores only a hash of the password', async () => {
      const app = await startApp();
      const { email } = await register(app);

      const stored = await withClient(database.admin, (client) =>
        client.query<{ password_hash: string }>(
          'SELECT password_hash FROM app.users WHERE email = $1',
          [email],
        ),
      );

      expect(stored.rows[0]?.password_hash).toMatch(/^scrypt\$/);
      expect(stored.rows[0]?.password_hash).not.toContain(TEST_PASSWORD);
    });

    it('refuses a second account with the same email, in any case', async () => {
      const app = await startApp();
      const { email } = await register(app);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { name: 'Outra', email: email.toUpperCase(), password: TEST_PASSWORD },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'EMAIL_IN_USE',
        message: 'Já existe uma conta com este e-mail.',
      });
    });

    it.each([
      ['an invalid email', { name: 'A', email: 'not-an-email', password: TEST_PASSWORD }, 'email'],
      ['a short password', { name: 'A', email: 'a@example.com', password: 'curta' }, 'password'],
      ['a missing name', { email: 'b@example.com', password: TEST_PASSWORD }, 'name'],
    ])('rejects a registration with %s', async (_case, payload, field) => {
      const app = await startApp();

      const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field }] });
    });

    it('logs in with the right password', async () => {
      const app = await startApp();
      const { email } = await register(app);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: TEST_PASSWORD },
      });

      expect(response.statusCode).toBe(200);
      expect(response.cookies.some((item) => item.name === SESSION_COOKIE)).toBe(true);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const app = await startApp();
      const { email } = await register(app);

      const wrongPassword = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'senha-errada-123' },
      });
      const unknownEmail = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ninguem@example.com', password: 'senha-errada-123' },
      });

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.json()).toEqual(unknownEmail.json());
      expect(wrongPassword.json()).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'E-mail ou senha incorretos.',
      });
    });

    it('limits login attempts per email', async () => {
      const app = await startApp(undefined, { loginAttemptsPerMinute: 3 });
      const { email } = await register(app);
      await waitForFreshRateWindow();
      const attempt = () =>
        app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senha-errada-123' },
        });

      const statuses = [];
      for (let index = 0; index < 4; index += 1) {
        statuses.push((await attempt()).statusCode);
      }

      expect(statuses).toEqual([401, 401, 401, 429]);
      // Even the right password is refused until the minute passes.
      const right = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: TEST_PASSWORD },
      });
      expect(right.statusCode).toBe(429);
      expect(right.json()).toMatchObject({ code: 'RATE_LIMITED' });
    });
  });

  describe('session', () => {
    it('returns the signed-in user', async () => {
      const app = await startApp();
      const { cookie, email } = await register(app);

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: as(cookie),
      });

      expect(response.json()).toMatchObject({ email });
    });

    it.each([
      ['no cookie', {}],
      ['a forged token', { cookie: `${SESSION_COOKIE}=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.` }],
      ['garbage', { cookie: `${SESSION_COOKIE}=garbage` }],
    ])('answers 401 with %s', async (_case, headers) => {
      const app = await startApp();

      for (const url of ['/api/auth/me', '/api/conversations', '/api/usage']) {
        const response = await app.inject({ method: 'GET', url, headers });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({
          code: 'UNAUTHORIZED',
          message: 'Autenticação necessária.',
        });
      }
    });

    it('clears the cookie on logout', async () => {
      const app = await startApp();
      const { cookie } = await register(app);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: as(cookie),
      });

      expect(response.statusCode).toBe(204);
      const cleared = response.cookies.find((item) => item.name === SESSION_COOKIE);
      expect(cleared?.value).toBe('');
      expect(cleared?.path).toBe('/api');
    });

    it('stops accepting the session of a deleted account', async () => {
      const app = await startApp();
      const { cookie, email } = await register(app);
      await withClient(database.admin, (client) =>
        client.query('DELETE FROM app.users WHERE email = $1', [email]),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: as(cookie),
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('CSRF protection', () => {
    it('refuses a change requested by another site, even with a valid session', async () => {
      const app = await startApp();
      const { cookie } = await register(app);

      const response = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        headers: { ...as(cookie), origin: 'https://evil.example' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    });

    it('accepts a change from the application origin', async () => {
      const app = await startApp();
      const { cookie } = await register(app);

      const response = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        headers: { ...as(cookie), origin: TEST_ALLOWED_ORIGIN },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('ownership', () => {
    it("hides one user's conversations from another", async () => {
      const app = await startApp(
        new ScriptedLlmProvider(
          [sqlAnswer(REGION_COUNT_SQL, 'table'), sqlAnswer(REGION_COUNT_SQL)],
          ['Cinco.'],
        ),
      );
      const alice = await register(app);
      const bob = await register(app);
      const conversation = await createConversation(app, alice.cookie);
      await ask(app, alice.cookie, conversation.id, 'Quantas regiões?');

      const list = await app.inject({
        method: 'GET',
        url: '/api/conversations',
        headers: as(bob.cookie),
      });
      const messages = await app.inject({
        method: 'GET',
        url: `/api/conversations/${conversation.id}/messages`,
        headers: as(bob.cookie),
      });
      const question = await ask(app, bob.cookie, conversation.id, 'Quantas regiões?');
      const execute = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversation.id}/messages/2/execute`,
        headers: as(bob.cookie),
        payload: { sql: REGION_COUNT_SQL },
      });

      expect(list.json()).toEqual({ items: [] });
      expect([messages.statusCode, question.statusCode, execute.statusCode]).toEqual([
        404, 404, 404,
      ]);
    });

    it('shows nobody the conversations created before authentication', async () => {
      const app = await startApp();
      const { cookie } = await register(app);
      const orphan = await withClient(database.admin, (client) =>
        client.query<{ id: string }>('INSERT INTO app.conversations DEFAULT VALUES RETURNING id'),
      );
      const orphanId = orphan.rows[0]?.id ?? '';

      const list = await app.inject({
        method: 'GET',
        url: '/api/conversations',
        headers: as(cookie),
      });
      const messages = await app.inject({
        method: 'GET',
        url: `/api/conversations/${orphanId}/messages`,
        headers: as(cookie),
      });

      expect(list.json<{ items: Conversation[] }>().items.map((item) => item.id)).not.toContain(
        orphanId,
      );
      expect(messages.statusCode).toBe(404);
    });
  });

  describe('limits, checked before the LLM', () => {
    it('refuses questions above the per-minute limit without calling the LLM', async () => {
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(REGION_COUNT_SQL), sqlAnswer(REGION_COUNT_SQL), sqlAnswer(REGION_COUNT_SQL)],
        ['Cinco.', 'Cinco.', 'Cinco.'],
      );
      const app = await startApp(provider, { questionsPerMinute: 2 });
      const { cookie } = await register(app);
      const conversation = await createConversation(app, cookie);
      await waitForFreshRateWindow();

      const statuses = [];
      for (let index = 0; index < 3; index += 1) {
        statuses.push(
          (await ask(app, cookie, conversation.id, `Pergunta ${String(index)}`)).statusCode,
        );
      }

      expect(statuses).toEqual([200, 200, 429]);
      expect(provider.requests).toHaveLength(2);
      const refused = await ask(app, cookie, conversation.id, 'Mais uma');
      const refusedBody = refused.json<{ retryAfterSeconds: number }>();
      expect(refusedBody).toEqual({
        code: 'RATE_LIMITED',
        message: 'Muitas requisições em pouco tempo. Aguarde um minuto e tente de novo.',
        retryAfterSeconds: expect.any(Number) as number,
      });
      // The window is one minute long (D-37).
      expect(refusedBody.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(refusedBody.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it('refuses questions once the daily token quota is used, without calling the LLM', async () => {
      // One answer costs 2 calls x (100 in + 20 out) = 240 tokens with the scripted LLM.
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(REGION_COUNT_SQL), sqlAnswer(REGION_COUNT_SQL)],
        ['Cinco.', 'Cinco.'],
      );
      const app = await startApp(provider, { dailyTokenQuota: 200 });
      const { cookie } = await register(app);
      const conversation = await createConversation(app, cookie);

      const first = await ask(app, cookie, conversation.id, 'Quantas regiões?');
      const second = await ask(app, cookie, conversation.id, 'Quantas regiões de novo?');

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
      const quotaBody = second.json<{ code: string; retryAfterSeconds: number }>();
      expect(quotaBody.code).toBe('QUOTA_EXCEEDED');
      // The quota resets at the next UTC midnight: never more than a day away.
      expect(quotaBody.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(quotaBody.retryAfterSeconds).toBeLessThanOrEqual(86_400);
      expect(provider.requests).toHaveLength(1);
    });

    it('reports the tokens spent today, overall and per conversation', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([sqlAnswer(REGION_COUNT_SQL)], ['Cinco.']),
        { dailyTokenQuota: 5000, questionsPerMinute: 7 },
      );
      const { cookie } = await register(app);
      const conversation = await createConversation(app, cookie);
      await ask(app, cookie, conversation.id, 'Quantas regiões?');

      const response = await app.inject({ method: 'GET', url: '/api/usage', headers: as(cookie) });

      expect(response.json<UsageSummary>()).toEqual({
        today: { inputTokens: 200, outputTokens: 40, calls: 2 },
        dailyTokenQuota: 5000,
        questionsPerMinute: 7,
        byConversation: [
          { conversationId: conversation.id, title: 'Quantas regiões?', tokens: 240 },
        ],
      });
    });
  });

  describe('cache of repeated questions', () => {
    const CACHE = { sqlCacheTtlSeconds: 3600, resultCacheTtlSeconds: 300 };
    const QUESTION = 'Quantas regiões existem no cadastro?';

    it('reuses the SQL and the result of a repeated question, until the schema changes', async () => {
      const first = new ScriptedLlmProvider([sqlAnswer(REGION_COUNT_SQL)], ['Cinco.', 'Cinco.']);
      const app = await startApp(first, CACHE);
      const { cookie } = await register(app);

      const events = parseSseBody(
        (await ask(app, cookie, (await createConversation(app, cookie)).id, QUESTION)).body,
      );
      expect(events.find((event) => event.event === 'rows')?.data).toMatchObject({
        result: { rows: [['5']] },
      });
      expect(events.at(-1)).toMatchObject({ event: 'done', data: { cached: false } });

      // A new region appears; the same question (in other words) is asked again.
      await withClient(database.admin, (client) =>
        client.query("INSERT INTO sales.regions (name) VALUES ('Região de teste')"),
      );
      const repeated = parseSseBody(
        (
          await ask(
            app,
            cookie,
            (await createConversation(app, cookie)).id,
            '  quantas regiões existem no cadastro ',
          )
        ).body,
      );

      // No new SQL generation, and the cached result is served (still 5).
      expect(first.requests).toHaveLength(1);
      expect(first.textRequests).toHaveLength(2);
      expect(repeated.find((event) => event.event === 'rows')?.data).toMatchObject({
        result: { rows: [['5']] },
      });
      // The client is told, so it can mark the answer as coming from the cache.
      expect(repeated.at(-1)).toMatchObject({ event: 'done', data: { cached: true } });

      // The schema changes (a column is added) and the application restarts:
      // the cache keys carry the schema version, so nothing is reused.
      await withClient(database.admin, (client) =>
        client.query('ALTER TABLE sales.regions ADD COLUMN note text'),
      );
      const second = new ScriptedLlmProvider([sqlAnswer(REGION_COUNT_SQL)], ['Seis.']);
      const restarted = await startApp(second, CACHE);
      const after = parseSseBody(
        (await ask(restarted, cookie, (await createConversation(restarted, cookie)).id, QUESTION))
          .body,
      );

      expect(second.requests).toHaveLength(1);
      expect(after.find((event) => event.event === 'rows')?.data).toMatchObject({
        result: { rows: [['6']] },
      });

      await withClient(database.admin, async (client) => {
        await client.query('ALTER TABLE sales.regions DROP COLUMN note');
        await client.query("DELETE FROM sales.regions WHERE name = 'Região de teste'");
      });
    });

    it('does not reuse SQL for a question that depends on the conversation', async () => {
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(REGION_COUNT_SQL), sqlAnswer('SELECT count(*) AS produtos FROM products')],
        ['Cinco.', 'Quarenta.'],
      );
      const app = await startApp(provider, CACHE);
      const { cookie } = await register(app);
      const conversation = await createConversation(app, cookie);

      await ask(app, cookie, conversation.id, 'Quantas regiões há na base de vendas?');
      await ask(app, cookie, conversation.id, 'Quantas regiões há na base de vendas?');

      // The second time it is a follow-up in the same conversation: asked again.
      expect(provider.requests).toHaveLength(2);
    });
  });
});
