import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Conversation, ConversationList, MessageList } from '@interview-lab/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import type { AppEnv } from '../../src/config/env.js';
import { ConversationService } from '../../src/conversation/conversation.service.js';
import { seedDemoData } from '../../src/database/seed.js';
import { LlmError } from '../../src/llm/llm-error.js';
import { LLM_PROVIDER } from '../../src/llm/llm-provider.js';
import {
  refusalAnswer,
  ScriptedLlmProvider,
  sqlAnswer,
  summaryAnswer,
} from '../support/scripted-llm-provider.js';
import { registerUser, sendCookieOnEveryRequest } from '../support/session.js';
import { parseSseBody, type ReceivedEvent } from '../support/sse-client.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

const CONVERSATIONS_URL = '/api/conversations';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const REGION_COUNT_SQL = 'SELECT count(*) AS regioes FROM regions';

// The LLM is scripted; HTTP, persistence, SQL guard, executor and PostgreSQL
// are real.
describe('conversations over HTTP', () => {
  let database: TestDatabase;
  const apps: NestFastifyApplication[] = [];

  async function startApp(
    provider: ScriptedLlmProvider,
    env: AppEnv = database.appEnv({ internalEndpointEnabled: true }),
  ): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(env)] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    apps.push(app);
    await signIn(app);
    return app;
  }

  // Each app gets its own account; the cookie is also kept for fetch() calls.
  let accounts = 0;
  let sessionCookie = '';
  async function signIn(app: NestFastifyApplication): Promise<void> {
    accounts += 1;
    sessionCookie = await registerUser(app, `pessoa${String(accounts)}@example.com`);
    sendCookieOnEveryRequest(app, sessionCookie);
  }

  async function currentUserId(app: NestFastifyApplication): Promise<string> {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    return response.json<{ id: string }>().id;
  }

  async function createConversation(app: NestFastifyApplication): Promise<Conversation> {
    const response = await app.inject({ method: 'POST', url: CONVERSATIONS_URL });
    expect(response.statusCode).toBe(201);
    return response.json<Conversation>();
  }

  async function ask(
    app: NestFastifyApplication,
    conversationId: string,
    question: string,
  ): Promise<ReceivedEvent[]> {
    const response = await app.inject({
      method: 'POST',
      url: `${CONVERSATIONS_URL}/${conversationId}/messages`,
      payload: { question },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    return parseSseBody(response.body);
  }

  async function messagesOf(app: NestFastifyApplication, conversationId: string) {
    const response = await app.inject({
      method: 'GET',
      url: `${CONVERSATIONS_URL}/${conversationId}/messages`,
    });
    return response.json<MessageList>().items;
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

  describe('answer stream', () => {
    it('sends sql, rows, tokens and done, in this order', async () => {
      const app = await startApp(
        new ScriptedLlmProvider(
          [
            sqlAnswer(
              'SELECT name AS regiao, id AS codigo FROM regions ORDER BY name',
              'bar',
              'regiao',
              'codigo',
            ),
          ],
          ['São cinco regiões.'],
        ),
      );
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Quais são as regiões?');

      expect(events.map((event) => event.event)).toEqual([
        'sql',
        'rows',
        'token',
        'token',
        'token',
        'done',
      ]);
      expect(events[0]?.data).toEqual({
        sql: 'SELECT name AS regiao, id AS codigo FROM regions ORDER BY name',
        attempt: 1,
      });
      expect(events[1]?.data).toMatchObject({
        result: { rowCount: 5, truncated: false },
        visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'codigo' },
      });
      expect(events.slice(2, 5).map((event) => event.data)).toEqual([
        { text: 'São ' },
        { text: 'cinco ' },
        { text: 'regiões.' },
      ]);
      expect(events[5]?.data).toEqual({
        messageId: expect.any(String) as string,
        status: 'answered',
        attempts: 1,
        usage: { inputTokens: 200, outputTokens: 40, calls: 2 },
        cached: false,
      });
    });

    it('sends a second sql event when the first SQL is refused', async () => {
      const app = await startApp(
        new ScriptedLlmProvider(
          [sqlAnswer('SELECT rolname FROM pg_roles'), sqlAnswer(REGION_COUNT_SQL)],
          ['São cinco.'],
        ),
      );
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Quantas regiões?');

      expect(events.map((event) => event.event)).toEqual([
        'sql',
        'sql',
        'rows',
        'token',
        'token',
        'done',
      ]);
      expect(events[1]?.data).toEqual({ sql: REGION_COUNT_SQL, attempt: 2 });
      expect(events.at(-1)?.data).toMatchObject({ status: 'answered', attempts: 2 });
    });

    it('answers a question that cannot be answered with the reason and done', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([refusalAnswer('Não há dados de estoque.')]),
      );
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Qual o estoque?');

      expect(events).toEqual([
        { event: 'token', data: { text: 'Não há dados de estoque.' } },
        {
          event: 'done',
          data: {
            messageId: expect.any(String) as string,
            status: 'not_answerable',
            attempts: 0,
            usage: { inputTokens: 100, outputTokens: 20, calls: 1 },
          },
        },
      ]);
    });
  });

  describe('errors in the middle of the stream', () => {
    it('ends with an error event when both SQL attempts are refused', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([
          sqlAnswer("DELETE FROM regions WHERE name = 'Sul'"),
          sqlAnswer('SELECT * FROM pg_authid'),
        ]),
      );
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Apague o Sul');

      expect(events.map((event) => event.event)).toEqual(['sql', 'sql', 'error']);
      expect(events.at(-1)?.data).toMatchObject({
        code: 'QUERY_REJECTED',
        message: 'A consulta foi recusada pelas regras de segurança.',
      });
    });

    it('ends with an error event when the LLM fails after the rows were sent', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([sqlAnswer(REGION_COUNT_SQL)], [new LlmError('LLM_UNAVAILABLE')]),
      );
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Quantas regiões?');

      expect(events.map((event) => event.event)).toEqual(['sql', 'rows', 'error']);
      expect(events.at(-1)?.data).toEqual({
        code: 'LLM_UNAVAILABLE',
        message: 'O serviço de IA está indisponível no momento.',
      });
    });

    it('reports an unexpected failure as a generic internal error', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([new Error('boom: connection string postgres://secret')]),
      );
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Quantas regiões?');

      expect(events).toEqual([
        { event: 'error', data: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.' } },
      ]);
    });

    it('reports a missing API key as an error event', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.register(database.appEnv({ internalEndpointEnabled: true }))],
      }).compile();
      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await configureApp(app);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      apps.push(app);
      await signIn(app);
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Quantas regiões?');

      expect(events).toEqual([
        {
          event: 'error',
          data: { code: 'LLM_NOT_CONFIGURED', message: 'O serviço de IA não está configurado.' },
        },
      ]);
    });
  });

  describe('history', () => {
    it('stores the question and the answer, without the result rows', async () => {
      const app = await startApp(
        new ScriptedLlmProvider(
          [sqlAnswer('SELECT name AS regiao FROM regions ORDER BY name')],
          ['São cinco regiões.'],
        ),
      );
      const conversation = await createConversation(app);
      await ask(app, conversation.id, 'Quais são as regiões?');

      const messages = await messagesOf(app, conversation.id);

      expect(messages).toEqual([
        {
          id: expect.any(String) as string,
          role: 'user',
          content: 'Quais são as regiões?',
          createdAt: expect.any(String) as string,
        },
        {
          id: expect.any(String) as string,
          role: 'assistant',
          content: 'São cinco regiões.',
          status: 'answered',
          sql: 'SELECT name AS regiao FROM regions ORDER BY name',
          visualization: { type: 'table' },
          rowCount: 5,
          createdAt: expect.any(String) as string,
        },
      ]);
      expect(JSON.stringify(messages)).not.toContain('Centro-Oeste');
    });

    it('stores a failed answer with its message', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([sqlAnswer(REGION_COUNT_SQL)], [new LlmError('LLM_UNAVAILABLE')]),
      );
      const conversation = await createConversation(app);
      await ask(app, conversation.id, 'Quantas regiões?');

      const messages = await messagesOf(app, conversation.id);

      expect(messages.map((message) => [message.role, message.status])).toEqual([
        ['user', undefined],
        ['assistant', 'error'],
      ]);
      expect(messages[1]?.content).toBe('O serviço de IA está indisponível no momento.');
    });

    it('titles the conversation with its first question and lists the most recent first', async () => {
      const app = await startApp(
        new ScriptedLlmProvider(
          [sqlAnswer(REGION_COUNT_SQL), sqlAnswer(REGION_COUNT_SQL)],
          ['Cinco.', 'Cinco.'],
        ),
      );
      const older = await createConversation(app);
      const newer = await createConversation(app);
      await ask(app, older.id, 'Pergunta da conversa antiga');
      await ask(app, newer.id, 'Pergunta da conversa nova');

      const response = await app.inject({ method: 'GET', url: CONVERSATIONS_URL });
      const listed = response.json<ConversationList>().items;

      const newerIndex = listed.findIndex((item) => item.id === newer.id);
      const olderIndex = listed.findIndex((item) => item.id === older.id);
      expect(listed[newerIndex]?.title).toBe('Pergunta da conversa nova');
      expect(listed[olderIndex]?.title).toBe('Pergunta da conversa antiga');
      expect(newerIndex).toBeLessThan(olderIndex);
    });

    it('gives the next question the previous messages as context', async () => {
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(REGION_COUNT_SQL), sqlAnswer('SELECT count(*) AS produtos FROM products')],
        ['São cinco regiões.', 'São quarenta produtos.'],
      );
      const app = await startApp(provider);
      const conversation = await createConversation(app);
      await ask(app, conversation.id, 'Quantas regiões existem?');

      await ask(app, conversation.id, 'E produtos?');

      const secondPrompt = provider.requests[1]?.prompt;
      expect(secondPrompt).toContain('user: Quantas regiões existem?');
      expect(secondPrompt).toContain('assistant: São cinco regiões.');
      expect(secondPrompt).toContain(`sql: ${REGION_COUNT_SQL}`);
      expect(secondPrompt).toContain('<question>\nE produtos?\n</question>');
      expect(provider.requests[0]?.prompt).not.toContain('<conversation>');
    });
  });

  describe('memory summary (D-27)', () => {
    it('summarizes the oldest messages once 12 are outside the summary, and not before', async () => {
      const rounds = 6;
      const provider = new ScriptedLlmProvider(
        [
          ...Array.from({ length: rounds }, () => sqlAnswer(REGION_COUNT_SQL)),
          summaryAnswer('O usuário perguntou seis vezes quantas regiões existem.'),
          sqlAnswer(REGION_COUNT_SQL),
        ],
        Array.from({ length: rounds + 1 }, (_unused, index) => `Resposta ${String(index + 1)}.`),
      );
      const app = await startApp(provider);
      const service = app.get(ConversationService);
      const userId = await currentUserId(app);
      const conversation = await createConversation(app);

      // 5 rounds = 10 messages: below the threshold, no summary call.
      for (let round = 1; round < rounds; round += 1) {
        await ask(app, conversation.id, `Pergunta ${String(round)}`);
      }
      expect(provider.requests).toHaveLength(rounds - 1);
      await expect(service.refreshMemory(userId, conversation.id)).resolves.toBe(false);

      // The 6th round reaches 12 messages: the controller refreshes the summary
      // right after the answer, covering the 6 oldest messages.
      await ask(app, conversation.id, `Pergunta ${String(rounds)}`);
      await expect.poll(() => provider.requests.length).toBe(rounds + 1);
      const summaryPrompt = provider.requests[rounds]?.prompt;
      expect(summaryPrompt).toContain('user: Pergunta 1');
      expect(summaryPrompt).toContain('assistant: Resposta 3.');
      expect(summaryPrompt).not.toContain('Pergunta 4');

      // The summary call is billed to the user like any other (Phase 08).
      const summaryUsage = await withClient(database.admin, (client) =>
        client.query<{ calls: number }>(
          "SELECT calls FROM app.token_usage WHERE user_id = $1 AND kind = 'summary'",
          [userId],
        ),
      );
      expect(summaryUsage.rows).toEqual([{ calls: 1 }]);

      // Nothing left to summarize until 6 more messages accumulate.
      await expect
        .poll(() => service.refreshMemory(userId, conversation.id).catch(() => undefined))
        .toBe(false);

      // The next question receives the summary plus the 6 recent messages.
      await ask(app, conversation.id, 'Pergunta 7');
      const nextPrompt = provider.requests[rounds + 1]?.prompt;
      expect(nextPrompt).toContain(
        'summary of earlier messages: O usuário perguntou seis vezes quantas regiões existem.',
      );
      expect(nextPrompt).not.toContain('user: Pergunta 1\n');
      expect(nextPrompt).toContain('user: Pergunta 4');
      expect(nextPrompt).toContain('assistant: Resposta 6.');
    });
  });

  describe('request validation, before the stream starts', () => {
    it.each([
      ['a missing question', {}],
      ['an empty question', { question: '  ' }],
      ['a non-string question', { question: 42 }],
      ['an oversized question', { question: 'x'.repeat(1001) }],
    ])('rejects %s with a normal 400 response', async (_case, payload) => {
      const app = await startApp(new ScriptedLlmProvider([]));
      const conversation = await createConversation(app);

      const response = await app.inject({
        method: 'POST',
        url: `${CONVERSATIONS_URL}/${conversation.id}/messages`,
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'question' }],
      });
    });

    it.each([
      ['an unknown conversation', UNKNOWN_ID],
      ['a malformed id', 'not-a-uuid'],
    ])('answers 404 for %s', async (_case, id) => {
      const app = await startApp(new ScriptedLlmProvider([]));

      const post = await app.inject({
        method: 'POST',
        url: `${CONVERSATIONS_URL}/${id}/messages`,
        payload: { question: 'Quantas regiões?' },
      });
      const get = await app.inject({ method: 'GET', url: `${CONVERSATIONS_URL}/${id}/messages` });

      expect(post.statusCode).toBe(404);
      expect(post.json()).toEqual({ code: 'NOT_FOUND', message: 'Recurso não encontrado.' });
      expect(get.statusCode).toBe(404);
    });

    it('requires a signed-in user', async () => {
      const app = await startApp(new ScriptedLlmProvider([]), database.appEnv());

      const response = await app.inject({
        method: 'POST',
        url: CONVERSATIONS_URL,
        headers: { cookie: 'interview_lab_session=not-a-valid-token' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        code: 'UNAUTHORIZED',
        message: 'Autenticação necessária.',
      });
    });
  });

  describe('client disconnection', () => {
    async function listen(app: NestFastifyApplication): Promise<string> {
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address() as AddressInfo;
      return `http://127.0.0.1:${String(address.port)}`;
    }

    // The executor runs user SQL through a cursor, so pg_stat_activity shows
    // the FETCH statement, not the original text.
    async function runningUserQueries(): Promise<number> {
      const result = await withClient(database.admin, (client) =>
        client.query<{ total: string }>(
          `SELECT count(*) AS total FROM pg_stat_activity
           WHERE usename = 'app_readonly' AND state = 'active' AND query LIKE 'FETCH%'`,
        ),
      );
      return Number(result.rows[0]?.total);
    }

    // Reads the stream until the first piece of the explanation arrives.
    async function readUntilFirstToken(response: Response): Promise<void> {
      if (response.body === null) {
        throw new Error('The response has no body');
      }
      const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
      const decoder = new TextDecoder();
      let received = '';
      while (!received.includes('event: token')) {
        const chunk = await reader.read();
        if (chunk.done) {
          throw new Error(`Stream ended before a token event: ${received}`);
        }
        received += decoder.decode(chunk.value, { stream: true });
      }
    }

    it('stops the LLM stream when the client leaves', async () => {
      const provider = new ScriptedLlmProvider(
        [sqlAnswer(REGION_COUNT_SQL)],
        ['palavra '.repeat(200)],
        { chunkDelayMs: 20 },
      );
      const app = await startApp(provider);
      const baseUrl = await listen(app);
      const conversation = await createConversation(app);
      const abort = new AbortController();

      const response = await fetch(`${baseUrl}${CONVERSATIONS_URL}/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: sessionCookie },
        body: JSON.stringify({ question: 'Quantas regiões?' }),
        signal: abort.signal,
      });
      await readUntilFirstToken(response);
      abort.abort();

      await expect.poll(() => provider.streamAborted, { timeout: 5000 }).toBe(true);
      // The interrupted answer is not stored; the question is.
      await expect
        .poll(async () => (await messagesOf(app, conversation.id)).map((message) => message.role))
        .toEqual(['user']);
    });

    it('cancels the running database query when the client leaves', async () => {
      // A cross join large enough to run until the statement timeout.
      const slowSql =
        'SELECT count(*) AS total FROM generate_series(1, 100000) a, generate_series(1, 100000) b';
      const provider = new ScriptedLlmProvider([sqlAnswer(slowSql)], ['nunca enviado']);
      const app = await startApp(provider);
      const baseUrl = await listen(app);
      const conversation = await createConversation(app);
      const abort = new AbortController();

      const request = fetch(`${baseUrl}${CONVERSATIONS_URL}/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: sessionCookie },
        body: JSON.stringify({ question: 'Conta lenta' }),
        signal: abort.signal,
      })
        .then((response) => response.text())
        // Aborting rejects either the request or the reading of its body.
        .catch(() => undefined);
      await expect.poll(runningUserQueries, { timeout: 5000 }).toBe(1);

      abort.abort();
      await request;

      // Well before the 5s statement timeout would have stopped it.
      await expect.poll(runningUserQueries, { timeout: 2000 }).toBe(0);
      expect(provider.textRequests).toHaveLength(0);
    });
  });
});
