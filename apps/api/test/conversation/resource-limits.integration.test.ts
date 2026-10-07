import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { ApiErrorBody, Conversation } from '@interview-lab/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { AppEnv } from '../../src/config/env.js';
import { seedDemoData } from '../../src/database/seed.js';
import { executionSlotKey } from '../../src/limits/execution-slots.js';
import { LlmError } from '../../src/llm/llm-error.js';
import { LLM_PROVIDER } from '../../src/llm/llm-provider.js';
import { ScriptedLlmProvider, sqlAnswer } from '../support/scripted-llm-provider.js';
import { registerUser } from '../support/session.js';
import { parseSseBody, type ReceivedEvent } from '../support/sse-client.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
  type TestEnvOptions,
} from '../support/test-database.js';

const CONVERSATIONS_URL = '/api/conversations';
const QUICK_SQL = 'SELECT count(*) AS regioes FROM regions';
// Properly joined, so it is not refused as a cross join, and slow enough to
// run until the statement timeout. Its estimated cost is far above the limit:
// the tests that use it raise QUERY_MAX_COST.
const SLOW_SQL =
  'SELECT count(*) AS total FROM generate_series(1, 100000) a JOIN generate_series(1, 100000) b ON a <> b';
const NO_COST_LIMIT = 1_000_000_000_000;

interface Account {
  id: string;
  cookie: string;
}

// Phase 10a: what keeps approved SQL from exhausting the database. The LLM is
// scripted; HTTP, Redis, the SQL guard, the executor and PostgreSQL are real.
describe('resource limits over HTTP', () => {
  let database: TestDatabase;
  let redis: Redis;
  const apps: NestFastifyApplication[] = [];
  let accounts = 0;

  async function startApp(
    provider: ScriptedLlmProvider,
    options: TestEnvOptions & { poolMax?: number } = {},
  ): Promise<{ app: NestFastifyApplication; baseUrl: string }> {
    const base = database.appEnv(options.query, { limits: { ...options.limits } });
    const env: AppEnv =
      options.poolMax === undefined
        ? base
        : { ...base, database: { ...base.database, poolMax: options.poolMax } };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(env)] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    apps.push(app);
    const address = app.getHttpServer().address() as AddressInfo;
    return { app, baseUrl: `http://127.0.0.1:${String(address.port)}` };
  }

  async function newAccount(app: NestFastifyApplication): Promise<Account> {
    accounts += 1;
    const cookie = await registerUser(app, `limite${String(accounts)}@example.com`);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    return { id: me.json<{ id: string }>().id, cookie };
  }

  async function createConversation(
    app: NestFastifyApplication,
    account: Account,
  ): Promise<Conversation> {
    const response = await app.inject({
      method: 'POST',
      url: CONVERSATIONS_URL,
      headers: { cookie: account.cookie },
    });
    expect(response.statusCode).toBe(201);
    return response.json<Conversation>();
  }

  function post(app: NestFastifyApplication, account: Account, url: string, payload: object) {
    return app.inject({ method: 'POST', url, payload, headers: { cookie: account.cookie } });
  }

  async function ask(
    app: NestFastifyApplication,
    account: Account,
    conversationId: string,
    mode?: 'review',
  ): Promise<ReceivedEvent[]> {
    const response = await post(app, account, `${CONVERSATIONS_URL}/${conversationId}/messages`, {
      question: 'Quantas regiões?',
      ...(mode && { mode }),
    });
    expect(response.statusCode).toBe(200);
    return parseSseBody(response.body);
  }

  // Starts a request over the network, so the test can leave before it ends.
  function startRequest(
    baseUrl: string,
    account: Account,
    path: string,
    body: unknown,
  ): { finished: Promise<string | undefined>; leave: () => void } {
    const abort = new AbortController();
    const finished = fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: account.cookie },
      body: JSON.stringify(body),
      signal: abort.signal,
    })
      .then((response) => response.text())
      // Leaving rejects either the request or the reading of its body.
      .catch(() => undefined);
    return {
      finished,
      leave: () => {
        abort.abort();
      },
    };
  }

  function startQuestion(baseUrl: string, account: Account, conversationId: string) {
    return startRequest(baseUrl, account, `${CONVERSATIONS_URL}/${conversationId}/messages`, {
      question: 'Conta lenta',
    });
  }

  // The executor runs user SQL through a cursor, so pg_stat_activity shows the
  // FETCH statement, not the original text.
  async function runningUserQueries(): Promise<number> {
    const result = await withClient(database.admin, (client) =>
      client.query<{ total: string }>(
        `SELECT count(*) AS total FROM pg_stat_activity
         WHERE usename = 'app_readonly' AND state = 'active' AND query LIKE 'FETCH%'`,
      ),
    );
    return Number(result.rows[0]?.total);
  }

  async function slotsInUse(account: Account): Promise<number> {
    return Number((await redis.get(executionSlotKey(account.id))) ?? '0');
  }

  beforeAll(async () => {
    database = await startTestDatabase({ redis: true });
    await migrateTestDatabase(database);
    await withClient(database.admin, seedDemoData);
    redis = new Redis(database.appEnv().redis.url);
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    // No query of one test may still be running when the next one counts them.
    await expect.poll(runningUserQueries, { timeout: 8000 }).toBe(0);
  });

  afterAll(async () => {
    await redis.quit();
    await database.stop();
  });

  describe('one execution at a time per user (D-66)', () => {
    const ONE_AT_A_TIME = {
      query: { maxCost: NO_COST_LIMIT },
      limits: { maxInflightPerUser: 1 },
    };

    it('refuses a second question while the first is running, before calling the LLM', async () => {
      const provider = new ScriptedLlmProvider([sqlAnswer(SLOW_SQL)], ['nunca enviado']);
      const { app, baseUrl } = await startApp(provider, ONE_AT_A_TIME);
      const account = await newAccount(app);
      const conversation = await createConversation(app, account);
      const first = startQuestion(baseUrl, account, conversation.id);
      await expect.poll(runningUserQueries, { timeout: 5000 }).toBe(1);

      const second = await post(app, account, `${CONVERSATIONS_URL}/${conversation.id}/messages`, {
        question: 'Outra pergunta',
      });

      // A plain HTTP error, not an event of a stream that had already started.
      expect(second.statusCode).toBe(429);
      expect(second.headers['content-type']).toContain('application/json');
      expect(second.json<ApiErrorBody>()).toEqual({
        code: 'EXECUTION_IN_PROGRESS',
        message:
          'Já existe uma pergunta sua em andamento. Aguarde ela terminar, ou pare-a, e tente de novo.',
      });
      expect(provider.requests).toHaveLength(1);

      first.leave();
      await first.finished;
    });

    it('does not hold another user back', async () => {
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(SLOW_SQL), sqlAnswer(QUICK_SQL)],
        ['São cinco regiões.'],
      );
      const { app, baseUrl } = await startApp(provider, ONE_AT_A_TIME);
      const busy = await newAccount(app);
      const other = await newAccount(app);
      const first = startQuestion(baseUrl, busy, (await createConversation(app, busy)).id);
      await expect.poll(runningUserQueries, { timeout: 5000 }).toBe(1);

      const events = await ask(app, other, (await createConversation(app, other)).id);

      expect(events.at(-1)?.event).toBe('done');
      expect(await slotsInUse(busy)).toBe(1);
      expect(await slotsInUse(other)).toBe(0);

      first.leave();
      await first.finished;
    });

    it('counts the execution of a reviewed SQL as well', async () => {
      const provider = new ScriptedLlmProvider([sqlAnswer(QUICK_SQL)], ['nunca enviado']);
      const { app, baseUrl } = await startApp(provider, ONE_AT_A_TIME);
      const account = await newAccount(app);
      const conversation = await createConversation(app, account);
      const review = (await ask(app, account, conversation.id, 'review')).at(-1);
      expect(review?.event).toBe('review');
      const { messageId } = review?.data as { messageId: string };
      const execution = startRequest(
        baseUrl,
        account,
        `${CONVERSATIONS_URL}/${conversation.id}/messages/${messageId}/execute`,
        { sql: SLOW_SQL },
      );
      await expect.poll(runningUserQueries, { timeout: 5000 }).toBe(1);

      const question = await post(
        app,
        account,
        `${CONVERSATIONS_URL}/${conversation.id}/messages`,
        { question: 'Outra pergunta' },
      );

      expect(question.statusCode).toBe(429);
      expect(question.json<ApiErrorBody>().code).toBe('EXECUTION_IN_PROGRESS');

      execution.leave();
      await execution.finished;
    });

    it('allows as many at once as the limit says', async () => {
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(SLOW_SQL), sqlAnswer(SLOW_SQL)],
        ['nunca enviado'],
      );
      const { app, baseUrl } = await startApp(provider, {
        query: { maxCost: NO_COST_LIMIT },
        limits: { maxInflightPerUser: 2 },
      });
      const account = await newAccount(app);
      const conversation = await createConversation(app, account);
      const first = startQuestion(baseUrl, account, conversation.id);
      const second = startQuestion(baseUrl, account, conversation.id);
      await expect.poll(runningUserQueries, { timeout: 5000 }).toBe(2);
      expect(await slotsInUse(account)).toBe(2);

      const third = await post(app, account, `${CONVERSATIONS_URL}/${conversation.id}/messages`, {
        question: 'A terceira',
      });

      expect(third.statusCode).toBe(429);
      first.leave();
      second.leave();
      await Promise.all([first.finished, second.finished]);
    });
  });

  describe('the slot is given back whatever happens', () => {
    it('after an answer', async () => {
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(QUICK_SQL), sqlAnswer(QUICK_SQL)],
        ['São cinco regiões.', 'São cinco regiões.'],
      );
      const { app } = await startApp(provider, { limits: { maxInflightPerUser: 1 } });
      const account = await newAccount(app);
      const conversation = await createConversation(app, account);

      const first = await ask(app, account, conversation.id);
      expect(first.at(-1)?.event).toBe('done');
      expect(await slotsInUse(account)).toBe(0);

      // And so the next question goes through.
      const second = await ask(app, account, conversation.id);
      expect(second.at(-1)?.event).toBe('done');
      expect(await slotsInUse(account)).toBe(0);
    });

    it('after the LLM fails', async () => {
      const provider = new ScriptedLlmProvider([new LlmError('LLM_UNAVAILABLE')]);
      const { app } = await startApp(provider, { limits: { maxInflightPerUser: 1 } });
      const account = await newAccount(app);

      const events = await ask(app, account, (await createConversation(app, account)).id);

      expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'LLM_UNAVAILABLE' } });
      expect(await slotsInUse(account)).toBe(0);
    });

    it('after the SQL is refused', async () => {
      const refused = 'SELECT * FROM orders CROSS JOIN order_items';
      const provider = new ScriptedLlmProvider([sqlAnswer(refused), sqlAnswer(refused)]);
      const { app } = await startApp(provider, { limits: { maxInflightPerUser: 1 } });
      const account = await newAccount(app);

      const events = await ask(app, account, (await createConversation(app, account)).id);

      expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'QUERY_REJECTED' } });
      expect(await slotsInUse(account)).toBe(0);
    });

    it('after the query times out', async () => {
      const provider = new ScriptedLlmProvider([sqlAnswer(SLOW_SQL)], ['nunca enviado']);
      const { app } = await startApp(provider, {
        query: { maxCost: NO_COST_LIMIT, statementTimeoutMs: 300, appTimeoutMs: 600 },
        limits: { maxInflightPerUser: 1 },
      });
      const account = await newAccount(app);

      const events = await ask(app, account, (await createConversation(app, account)).id);

      expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'QUERY_TIMEOUT' } });
      expect(await slotsInUse(account)).toBe(0);
    });

    it('after the client leaves in the middle of the query', async () => {
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(SLOW_SQL), sqlAnswer(QUICK_SQL)],
        ['São cinco regiões.'],
      );
      const { app, baseUrl } = await startApp(provider, {
        query: { maxCost: NO_COST_LIMIT },
        limits: { maxInflightPerUser: 1 },
      });
      const account = await newAccount(app);
      const conversation = await createConversation(app, account);
      const first = startQuestion(baseUrl, account, conversation.id);
      await expect.poll(runningUserQueries, { timeout: 5000 }).toBe(1);
      expect(await slotsInUse(account)).toBe(1);

      first.leave();
      await first.finished;

      await expect.poll(() => slotsInUse(account), { timeout: 3000 }).toBe(0);
      // Stopping and asking again works right away.
      const next = await ask(app, account, conversation.id);
      expect(next.at(-1)?.event).toBe('done');
    });

    it('after a request refused before it started', async () => {
      const { app } = await startApp(new ScriptedLlmProvider([]), {
        limits: { maxInflightPerUser: 1, questionsPerMinute: 1 },
      });
      const account = await newAccount(app);
      const conversation = await createConversation(app, account);
      const url = `${CONVERSATIONS_URL}/${conversation.id}/messages`;

      // No pending review with this id: 404, after the slot was taken.
      const missing = await post(app, account, `${url}/999999/execute`, { sql: QUICK_SQL });
      expect(missing.statusCode).toBe(404);
      expect(await slotsInUse(account)).toBe(0);

      // The 404 above used the only question of this minute: 429, slot back.
      const limited = await post(app, account, url, { question: 'Quantas regiões?' });
      expect(limited.json<ApiErrorBody>().code).toBe('RATE_LIMITED');
      expect(await slotsInUse(account)).toBe(0);
    });
  });

  it('does not count a question refused for concurrency against the rate limit', async () => {
    const provider = new ScriptedLlmProvider(
      [sqlAnswer(SLOW_SQL), sqlAnswer(QUICK_SQL)],
      ['São cinco regiões.'],
    );
    const { app, baseUrl } = await startApp(provider, {
      query: { maxCost: NO_COST_LIMIT },
      limits: { maxInflightPerUser: 1, questionsPerMinute: 2 },
    });
    const account = await newAccount(app);
    const conversation = await createConversation(app, account);
    const url = `${CONVERSATIONS_URL}/${conversation.id}/messages`;
    const first = startQuestion(baseUrl, account, conversation.id);
    await expect.poll(runningUserQueries, { timeout: 5000 }).toBe(1);

    const refused = await post(app, account, url, { question: 'Cedo demais' });
    expect(refused.json<ApiErrorBody>().code).toBe('EXECUTION_IN_PROGRESS');
    first.leave();
    await first.finished;
    await expect.poll(() => slotsInUse(account), { timeout: 3000 }).toBe(0);

    // The second question of the minute is still available.
    const events = await ask(app, account, conversation.id);
    expect(events.at(-1)?.event).toBe('done');
  });

  // D-65: the chat has its own connections. With all of them busy, everything
  // that reads through statements written in the code still answers.
  it('keeps the rest of the application answering while the chat pool is busy', async () => {
    const POOL = 2;
    const provider = new ScriptedLlmProvider(
      [sqlAnswer(SLOW_SQL), sqlAnswer(SLOW_SQL)],
      ['nunca enviado'],
    );
    const { app, baseUrl } = await startApp(provider, {
      query: { maxCost: NO_COST_LIMIT },
      poolMax: POOL,
    });
    const people = [await newAccount(app), await newAccount(app)];
    const running = await Promise.all(
      people.map(async (account) =>
        startQuestion(baseUrl, account, (await createConversation(app, account)).id),
      ),
    );
    await expect.poll(runningUserQueries, { timeout: 5000 }).toBe(POOL);
    const visitor = await newAccount(app);

    const startedAt = performance.now();
    const answers = await Promise.all(
      [
        '/api/health',
        '/api/auth/me',
        '/api/schema',
        '/api/dashboard/filters',
        '/api/dashboard/overview?period=month',
        '/api/dashboard/stock-alerts',
        '/api/dashboard/stock-movements',
      ].map((url) => app.inject({ method: 'GET', url, headers: { cookie: visitor.cookie } })),
    );
    const elapsedMs = performance.now() - startedAt;

    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    // The slow questions hold their connections for 5 s; nobody waited for them.
    expect(await runningUserQueries()).toBe(POOL);
    expect(elapsedMs).toBeLessThan(4000);

    for (const request of running) {
      request.leave();
    }
    await Promise.all(running.map((request) => request.finished));
  });
});
