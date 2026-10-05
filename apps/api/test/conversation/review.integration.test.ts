import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Conversation, MessageList } from '@interview-lab/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { seedDemoData } from '../../src/database/seed.js';
import { LLM_PROVIDER } from '../../src/llm/llm-provider.js';
import { refusalAnswer, ScriptedLlmProvider, sqlAnswer } from '../support/scripted-llm-provider.js';
import { registerUser, sendCookieOnEveryRequest } from '../support/session.js';
import { parseSseBody, type ReceivedEvent } from '../support/sse-client.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const CONVERSATIONS_URL = '/api/conversations';
const GENERATED_SQL = 'SELECT name AS regiao, id AS codigo FROM regions ORDER BY name';

// Review mode (Phase 07): the LLM is scripted; HTTP, persistence, SQL guard,
// executor and PostgreSQL are real.
describe('review mode over HTTP', () => {
  let database: TestDatabase;
  const apps: NestFastifyApplication[] = [];

  async function startApp(provider: ScriptedLlmProvider): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(database.appEnv({ internalEndpointEnabled: true }))],
    })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    apps.push(app);
    accounts += 1;
    sendCookieOnEveryRequest(
      app,
      await registerUser(app, `revisor${String(accounts)}@example.com`),
    );
    return app;
  }

  let accounts = 0;

  async function createConversation(app: NestFastifyApplication): Promise<Conversation> {
    const response = await app.inject({ method: 'POST', url: CONVERSATIONS_URL });
    return response.json<Conversation>();
  }

  async function askForReview(
    app: NestFastifyApplication,
    conversationId: string,
    question = 'Quais são as regiões?',
  ): Promise<ReceivedEvent[]> {
    const response = await app.inject({
      method: 'POST',
      url: `${CONVERSATIONS_URL}/${conversationId}/messages`,
      payload: { question, mode: 'review' },
    });
    expect(response.statusCode).toBe(200);
    return parseSseBody(response.body);
  }

  function execute(
    app: NestFastifyApplication,
    conversationId: string,
    messageId: string,
    sql: unknown,
  ) {
    return app.inject({
      method: 'POST',
      url: `${CONVERSATIONS_URL}/${conversationId}/messages/${messageId}/execute`,
      payload: { sql },
    });
  }

  // Creates a conversation with one message waiting for review.
  async function pendingReview(provider: ScriptedLlmProvider) {
    const app = await startApp(provider);
    const conversation = await createConversation(app);
    const events = await askForReview(app, conversation.id);
    const review = events.at(-1)?.data as { messageId: string; sql: string };
    return { app, conversationId: conversation.id, messageId: review.messageId };
  }

  async function messagesOf(app: NestFastifyApplication, conversationId: string) {
    const response = await app.inject({
      method: 'GET',
      url: `${CONVERSATIONS_URL}/${conversationId}/messages`,
    });
    return response.json<MessageList>().items;
  }

  async function regionCount(): Promise<number> {
    const result = await withClient(database.admin, (client) =>
      client.query<{ total: string }>('SELECT count(*) AS total FROM sales.regions'),
    );
    return Number(result.rows[0]?.total);
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

  describe('asking in review mode', () => {
    it('stops after the SQL with a review event, without running it', async () => {
      const provider = new ScriptedLlmProvider([
        sqlAnswer(GENERATED_SQL, 'bar', 'regiao', 'codigo'),
      ]);
      const app = await startApp(provider);
      const conversation = await createConversation(app);

      const events = await askForReview(app, conversation.id);

      expect(events).toEqual([
        { event: 'sql', data: { sql: GENERATED_SQL, attempt: 1 } },
        { event: 'review', data: { messageId: expect.any(String) as string, sql: GENERATED_SQL } },
      ]);
      expect(provider.textRequests).toHaveLength(0);
      const messages = await messagesOf(app, conversation.id);
      expect(messages.at(-1)).toMatchObject({
        role: 'assistant',
        status: 'pending_review',
        sql: GENERATED_SQL,
        content: '',
      });
      expect(messages.at(-1)).not.toHaveProperty('visualization');
    });

    it('shows the user only SQL that already passed the guard', async () => {
      const provider = new ScriptedLlmProvider([
        sqlAnswer('SELECT * FROM pg_authid'),
        sqlAnswer(GENERATED_SQL),
      ]);
      const app = await startApp(provider);
      const conversation = await createConversation(app);

      const events = await askForReview(app, conversation.id);

      expect(events.map((event) => event.event)).toEqual(['sql', 'sql', 'review']);
      expect(events.at(-1)?.data).toMatchObject({ sql: GENERATED_SQL });
    });

    it('answers a question that cannot be answered without a review', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([refusalAnswer('Não há dados de estoque.')]),
      );
      const conversation = await createConversation(app);

      const events = await askForReview(app, conversation.id, 'Qual o estoque?');

      expect(events.map((event) => event.event)).toEqual(['token', 'done']);
    });

    it('rejects an unknown mode before the stream starts', async () => {
      const app = await startApp(new ScriptedLlmProvider([]));
      const conversation = await createConversation(app);

      const response = await app.inject({
        method: 'POST',
        url: `${CONVERSATIONS_URL}/${conversation.id}/messages`,
        payload: { question: 'Quais são as regiões?', mode: 'execute-anything' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ details: [{ field: 'mode' }] });
    });
  });

  describe('executing the reviewed SQL', () => {
    it('runs the approved SQL as is and records that it was not edited', async () => {
      const { app, conversationId, messageId } = await pendingReview(
        new ScriptedLlmProvider(
          [sqlAnswer(GENERATED_SQL, 'bar', 'regiao', 'codigo')],
          ['São cinco regiões.'],
        ),
      );

      const response = await execute(app, conversationId, messageId, GENERATED_SQL);
      const events = parseSseBody(response.body);

      expect(response.statusCode).toBe(200);
      expect(events.map((event) => event.event)).toEqual([
        'rows',
        'token',
        'token',
        'token',
        'done',
      ]);
      expect(events[0]?.data).toMatchObject({
        result: { rowCount: 5 },
        visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'codigo' },
      });
      expect(events.at(-1)?.data).toMatchObject({ messageId, status: 'answered', edited: false });

      const stored = (await messagesOf(app, conversationId)).at(-1);
      expect(stored).toMatchObject({
        id: messageId,
        status: 'answered',
        content: 'São cinco regiões.',
        sql: GENERATED_SQL,
        edited: false,
        rowCount: 5,
      });
      expect(stored).not.toHaveProperty('generatedSql');
    });

    it('runs the edited SQL and keeps the generated one for audit', async () => {
      const editedSql = "SELECT name AS regiao FROM regions WHERE name LIKE 'N%' ORDER BY name";
      const { app, conversationId, messageId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)], ['Duas regiões começam com N.']),
      );

      const events = parseSseBody((await execute(app, conversationId, messageId, editedSql)).body);

      expect(events[0]?.data).toMatchObject({
        result: { rows: [['Nordeste'], ['Norte']], rowCount: 2 },
      });
      expect(events.at(-1)?.data).toMatchObject({ status: 'answered', edited: true });
      expect((await messagesOf(app, conversationId)).at(-1)).toMatchObject({
        status: 'answered',
        sql: editedSql,
        edited: true,
        generatedSql: GENERATED_SQL,
      });
    });

    it('applies the LIMIT rules to the edited SQL', async () => {
      const { app, conversationId, messageId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)], ['Lista de pedidos.']),
      );

      const events = parseSseBody(
        (await execute(app, conversationId, messageId, 'SELECT id FROM orders LIMIT 50000')).body,
      );

      expect(events[0]?.data).toMatchObject({ result: { rowCount: 1000, truncated: true } });
    });
  });

  // Critério do PLANO.md: SQL malicioso enviado direto à API, simulando uma
  // edição, é rejeitado pela mesma guarda — o frontend não é fronteira.
  describe('malicious SQL sent as an edit', () => {
    it.each([
      ['a DELETE', 'DELETE FROM regions'],
      ['a DROP', 'DROP TABLE sales.order_items'],
      [
        'an UPDATE hidden in a CTE',
        "WITH x AS (UPDATE regions SET name = 'x' RETURNING *) SELECT * FROM x",
      ],
      ['a second statement', 'SELECT 1; DELETE FROM regions'],
      ['a system catalog', 'SELECT rolname, rolpassword FROM pg_authid'],
      ['the application data', 'SELECT content FROM app.messages'],
      ['a dangerous function', 'SELECT pg_sleep(30)'],
      ['a session change', "SELECT set_config('statement_timeout', '0', false)"],
      ['SELECT INTO', 'SELECT * INTO stolen FROM regions'],
      ['a large object write', "SELECT lo_from_bytea(0, 'x')"],
    ])('rejects %s and leaves the review pending', async (_case, sql) => {
      const { app, conversationId, messageId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)], ['Resposta depois da correção.']),
      );
      const startedAt = Date.now();

      const response = await execute(app, conversationId, messageId, sql);

      expect(response.statusCode).toBe(200);
      expect(parseSseBody(response.body)).toEqual([
        {
          event: 'error',
          data: {
            code: 'QUERY_REJECTED',
            message: 'A consulta foi recusada pelas regras de segurança.',
            details: [{ field: 'sql', message: expect.any(String) as string }],
          },
        },
      ]);
      // Refused before reaching the database (pg_sleep(30) would take 30s).
      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(await regionCount()).toBe(5);
      expect((await messagesOf(app, conversationId)).at(-1)).toMatchObject({
        status: 'pending_review',
        sql: GENERATED_SQL,
      });

      // The user can still fix the SQL and run it.
      const retry = parseSseBody(
        (await execute(app, conversationId, messageId, GENERATED_SQL)).body,
      );
      expect(retry.at(-1)).toMatchObject({ event: 'done', data: { status: 'answered' } });
    });
  });

  describe('request validation, before the stream starts', () => {
    it('answers 409 while the same review is being executed', async () => {
      const { app, conversationId, messageId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)], ['palavra '.repeat(30)], {
          chunkDelayMs: 20,
        }),
      );

      const first = execute(app, conversationId, messageId, GENERATED_SQL);
      // Let the first execution reach the explanation before the second arrives.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const second = await execute(app, conversationId, messageId, GENERATED_SQL);

      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ code: 'CONFLICT' });
      expect(parseSseBody((await first).body).at(-1)).toMatchObject({ event: 'done' });
    });

    it('runs only one of two executions sent at the same moment', async () => {
      const { app, conversationId, messageId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)], ['Cinco.', 'Cinco.']),
      );

      const responses = await Promise.all([
        execute(app, conversationId, messageId, GENERATED_SQL),
        execute(app, conversationId, messageId, GENERATED_SQL),
      ]);

      // Both requests finish (none is left hanging) and exactly one runs.
      const outcomes = responses.map((response) =>
        response.statusCode === 200
          ? parseSseBody(response.body).at(-1)?.event
          : response.statusCode,
      );
      expect(outcomes.filter((outcome) => outcome === 'done')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 409 || outcome === 404)).toHaveLength(1);
    });

    it('answers 404 when the review was already executed', async () => {
      const { app, conversationId, messageId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)], ['Cinco.']),
      );
      await execute(app, conversationId, messageId, GENERATED_SQL);

      const again = await execute(app, conversationId, messageId, GENERATED_SQL);

      expect(again.statusCode).toBe(404);
      expect(again.json()).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('answers 404 for a message that is not waiting for review', async () => {
      const app = await startApp(new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)], ['Cinco.']));
      const conversation = await createConversation(app);
      await app.inject({
        method: 'POST',
        url: `${CONVERSATIONS_URL}/${conversation.id}/messages`,
        payload: { question: 'Quais são as regiões?' },
      });
      const answered = (await messagesOf(app, conversation.id)).at(-1);

      const response = await execute(app, conversation.id, answered?.id ?? '', GENERATED_SQL);

      expect(response.statusCode).toBe(404);
    });

    it('answers 404 for a review of another conversation', async () => {
      const { app, messageId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)]),
      );
      const other = await createConversation(app);

      const response = await execute(app, other.id, messageId, GENERATED_SQL);

      expect(response.statusCode).toBe(404);
    });

    it.each([
      ['a malformed message id', 'abc'],
      ['a negative message id', '-1'],
      ['an unknown message id', '999999'],
    ])('answers 404 for %s', async (_case, messageId) => {
      const { app, conversationId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)]),
      );

      const response = await execute(app, conversationId, messageId, GENERATED_SQL);

      expect(response.statusCode).toBe(404);
    });

    it.each([
      ['a missing SQL', undefined],
      ['an empty SQL', '  '],
      ['a non-string SQL', 42],
      ['an oversized SQL', `SELECT '${'x'.repeat(10_000)}'`],
    ])('rejects %s with 400', async (_case, sql) => {
      const { app, conversationId, messageId } = await pendingReview(
        new ScriptedLlmProvider([sqlAnswer(GENERATED_SQL)]),
      );

      const response = await execute(app, conversationId, messageId, sql);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'sql' }],
      });
    });
  });
});
