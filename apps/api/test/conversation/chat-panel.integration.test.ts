import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  Conversation,
  ConversationList,
  MessageList,
  SchemaOverview,
  UsageSummary,
} from '@interview-lab/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { seedDemoData } from '../../src/database/seed.js';
import { usageLevel } from '../../src/limits/usage.service.js';
import { LLM_PROVIDER } from '../../src/llm/llm-provider.js';
import { ScriptedLlmProvider, sqlAnswer } from '../support/scripted-llm-provider.js';
import { registerUser, sendCookieOnEveryRequest } from '../support/session.js';
import { parseSseBody } from '../support/sse-client.js';
import {
  migrateTestDatabase,
  startTestDatabase,
  withClient,
  type TestDatabase,
} from '../support/test-database.js';

// Phase 09b: what the three-column chat needs from the API.
describe('chat panel data', () => {
  let database: TestDatabase;
  const apps: NestFastifyApplication[] = [];
  let accounts = 0;

  async function startApp(
    provider = new ScriptedLlmProvider([]),
    query: { statementTimeoutMs?: number; appTimeoutMs?: number } = {},
  ): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(database.appEnv(query))],
    })
      .overrideProvider(LLM_PROVIDER)
      .useValue(provider)
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    accounts += 1;
    sendCookieOnEveryRequest(app, await registerUser(app, `painel${String(accounts)}@example.com`));
    apps.push(app);
    return app;
  }

  async function createConversation(app: NestFastifyApplication): Promise<Conversation> {
    return (await app.inject({ method: 'POST', url: '/api/conversations' })).json<Conversation>();
  }

  async function ask(app: NestFastifyApplication, id: string, question: string, mode = 'auto') {
    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${id}/messages`,
      payload: { question, mode },
    });
    return parseSseBody(response.body);
  }

  async function listed(app: NestFastifyApplication): Promise<Conversation[]> {
    return (await app.inject({ method: 'GET', url: '/api/conversations' })).json<ConversationList>()
      .items;
  }

  beforeAll(async () => {
    // Redis too: asking a question goes through the rate limit.
    database = await startTestDatabase({ redis: true });
    await migrateTestDatabase(database);
    await withClient(database.admin, seedDemoData);
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await database.stop();
  });

  describe('GET /api/schema', () => {
    it('requires a session', async () => {
      const app = await startApp();

      const response = await app.inject({
        method: 'GET',
        url: '/api/schema',
        headers: { cookie: '' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('lists exactly the tables the AI can read', async () => {
      const app = await startApp();

      const schema = (
        await app.inject({ method: 'GET', url: '/api/schema' })
      ).json<SchemaOverview>();

      expect(schema.tables.map((table) => table.name)).toEqual([
        'customers',
        'distribution_centers',
        'order_items',
        'orders',
        'products',
        'regions',
        'stock_levels',
        'stock_movements',
      ]);
      // Nothing of the application's own data.
      expect(JSON.stringify(schema)).not.toContain('password');
      expect(JSON.stringify(schema)).not.toContain('token_usage');
    });

    it('marks primary keys and what each foreign key points to', async () => {
      const app = await startApp();
      const schema = (
        await app.inject({ method: 'GET', url: '/api/schema' })
      ).json<SchemaOverview>();
      const columnsOf = (name: string) =>
        schema.tables.find((table) => table.name === name)?.columns ?? [];

      expect(columnsOf('regions')).toEqual([
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'name', type: 'text', nullable: false, primaryKey: false },
      ]);
      expect(columnsOf('orders').find((column) => column.name === 'customer_id')).toEqual({
        name: 'customer_id',
        type: 'bigint',
        nullable: false,
        primaryKey: false,
        references: { table: 'customers', column: 'id' },
      });
      expect(columnsOf('orders').find((column) => column.name === 'delivered_at')).toMatchObject({
        type: 'timestamp with time zone',
        nullable: true,
      });
      // A key over two columns: both are part of the primary key.
      expect(
        columnsOf('stock_levels')
          .filter((column) => column.primaryKey)
          .map((column) => column.name),
      ).toEqual(['distribution_center_id', 'product_id']);
      // Two foreign keys to the same table, each on its own column.
      const movement = columnsOf('stock_movements');
      expect(
        movement.find((column) => column.name === 'destination_center_id')?.references,
      ).toEqual({ table: 'distribution_centers', column: 'id' });
      expect(movement.find((column) => column.name === 'quantity')).not.toHaveProperty(
        'references',
      );
    });
  });

  describe('tables an answer was based on', () => {
    it('come with the answer and with the history, without CTE names', async () => {
      const sql = `WITH resumo AS (
          SELECT r.name, count(*) AS total
          FROM orders o
          JOIN distribution_centers dc ON dc.id = o.distribution_center_id
          JOIN regions r ON r.id = dc.region_id
          GROUP BY r.name
        )
        SELECT * FROM resumo`;
      const app = await startApp(new ScriptedLlmProvider([sqlAnswer(sql)], ['Cinco regiões.']));
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Pedidos por região?');

      const tables = ['orders', 'distribution_centers', 'regions'];
      expect(events.at(-1)).toMatchObject({ event: 'done', data: { tables } });
      const history = (
        await app.inject({ method: 'GET', url: `/api/conversations/${conversation.id}/messages` })
      ).json<MessageList>();
      expect(history.items[1]?.tables).toEqual(tables);
      // The question has no SQL, and so no tables.
      expect(history.items[0]).not.toHaveProperty('tables');
    });
  });

  describe('conversations that need attention', () => {
    it('does not flag a conversation that was answered', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([sqlAnswer('SELECT name FROM regions')], ['Cinco.']),
      );
      const conversation = await createConversation(app);
      await ask(app, conversation.id, 'Quais regiões?');

      expect((await listed(app))[0]).not.toHaveProperty('attention');
    });

    it('flags a conversation waiting for review', async () => {
      const app = await startApp(new ScriptedLlmProvider([sqlAnswer('SELECT name FROM regions')]));
      const conversation = await createConversation(app);
      await ask(app, conversation.id, 'Quais regiões?', 'review');

      expect((await listed(app))[0]).toMatchObject({
        id: conversation.id,
        attention: 'pending_review',
      });
    });

    it('flags a conversation whose last answer was blocked by the SQL guard', async () => {
      // Both attempts are refused: the answer ends as an error.
      const app = await startApp(
        new ScriptedLlmProvider([
          sqlAnswer('DELETE FROM regions'),
          sqlAnswer('DROP TABLE regions'),
        ]),
      );
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Apague as regiões');

      expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'QUERY_REJECTED' } });
      expect((await listed(app))[0]?.attention).toBe('blocked');
    });

    it('flags a conversation whose last query ran out of time', async () => {
      const app = await startApp(
        new ScriptedLlmProvider([
          sqlAnswer('SELECT count(*) FROM orders a, orders b, orders c, orders d'),
        ]),
        { statementTimeoutMs: 100, appTimeoutMs: 400 },
      );
      const conversation = await createConversation(app);

      const events = await ask(app, conversation.id, 'Conta tudo');

      expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'QUERY_TIMEOUT' } });
      expect((await listed(app))[0]?.attention).toBe('timeout');
    });

    it('does not flag other failures, nor after a later answer', async () => {
      const app = await startApp(
        new ScriptedLlmProvider(
          [new Error('provider down'), sqlAnswer('DELETE FROM regions'), sqlAnswer('DROP TABLE x')],
          [],
        ),
      );
      const conversation = await createConversation(app);

      await ask(app, conversation.id, 'Primeira');
      expect((await listed(app))[0]).not.toHaveProperty('attention');

      await ask(app, conversation.id, 'Segunda');
      expect((await listed(app))[0]?.attention).toBe('blocked');
    });
  });

  describe('usage level', () => {
    it('comes with the usage summary', async () => {
      const app = await startApp();

      const usage = (await app.inject({ method: 'GET', url: '/api/usage' })).json<UsageSummary>();

      expect(usage.level).toBe('normal');
    });

    it.each([
      [0, 'normal'],
      [149_999, 'normal'],
      [150_000, 'attention'],
      [179_999, 'attention'],
      [180_000, 'critical'],
      [200_000, 'critical'],
      [250_000, 'critical'],
    ])('reads %i of 200,000 tokens as %s', (tokens, level) => {
      expect(usageLevel(tokens, 200_000)).toBe(level);
    });
  });
});
