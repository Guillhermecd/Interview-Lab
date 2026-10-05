import type {
  AnswerStreamEventName,
  AnswerStreamEvents,
  Conversation,
  ConversationMessage,
} from '@interview-lab/shared';
import type { Page, Route } from '@playwright/test';
import {
  FILTER_OPTIONS,
  OVERVIEW,
  STOCK_ALERTS,
  STOCK_MOVEMENTS,
} from '../src/test/dashboard-fixtures';
import {
  CATALOG_OPTIONS,
  CEMENT,
  CEMENT_DETAIL,
  MOVEMENT_PAGE,
  RECORDED_MOVEMENT,
} from '../src/test/catalog-fixtures';

export type StreamEvent = {
  [Name in AnswerStreamEventName]: { event: Name; data: AnswerStreamEvents[Name] };
}[AnswerStreamEventName];

const CONVERSATIONS_PATH = '/api/conversations';

export const E2E_USER = {
  id: 'u-1',
  email: 'ana@example.com',
  name: 'Ana',
  canManageCatalog: false,
};

interface FakeBackendOptions {
  conversations?: Conversation[];
  history?: Record<string, ConversationMessage[]>;
  // The events answered to the next question, in order of the questions.
  answers?: StreamEvent[][];
  // The events answered to the next execution of a reviewed SQL.
  executions?: StreamEvent[][];
  // Starts without a session (the login screen appears first).
  signedOut?: boolean;
  // The signed-in user may use the registry.
  admin?: boolean;
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function sse(route: Route, events: StreamEvent[]): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: events
      .map((item) => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`)
      .join(''),
  });
}

// Simulates the API in the browser: conversations, history and answer streams.
// Records the questions it received.
export async function useFakeBackend(page: Page, options: FakeBackendOptions = {}) {
  const conversations = [...(options.conversations ?? [])];
  const answers = [...(options.answers ?? [])];
  const executions = [...(options.executions ?? [])];
  const questions: string[] = [];
  let signedIn = options.signedOut !== true;
  const currentUser = { ...E2E_USER, canManageCatalog: options.admin === true };
  const logins: { email: string; password: string }[] = [];

  await page.route('**/api/auth/me', (route) =>
    signedIn
      ? json(route, currentUser)
      : json(route, { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' }, 401),
  );
  await page.route('**/api/auth/login', async (route) => {
    logins.push(route.request().postDataJSON() as { email: string; password: string });
    signedIn = true;
    await json(route, currentUser);
  });
  await page.route('**/api/auth/logout', async (route) => {
    signedIn = false;
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/usage', (route) =>
    json(route, {
      today: { inputTokens: 1200, outputTokens: 300, calls: 4 },
      dailyTokenQuota: 200000,
      questionsPerMinute: 10,
      byConversation: [],
    }),
  );
  // The dashboard: the same answers whatever the filters, and a record of what
  // was asked, so a test can check the filters reached the API.
  const dashboardRequests: string[] = [];
  const dashboard: Record<string, unknown> = {
    filters: FILTER_OPTIONS,
    overview: OVERVIEW,
    'stock-alerts': STOCK_ALERTS,
    'stock-movements': STOCK_MOVEMENTS,
  };
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split('/').at(-1) ?? '';
    dashboardRequests.push(`${resource}${url.search}`);
    await json(route, dashboard[resource] ?? {}, resource in dashboard ? 200 : 404);
  });

  // The registry. Everything answers 403 unless the user is an administrator,
  // as the real API does.
  const products = [CEMENT];
  const movements = [...MOVEMENT_PAGE.items];
  const catalogWrites: { method: string; path: string; body: unknown }[] = [];
  await page.route('**/api/catalog/**', async (route) => {
    if (!currentUser.canManageCatalog) {
      await json(route, { code: 'FORBIDDEN', message: 'Acesso negado.' }, 403);
      return;
    }
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/catalog/', '');
    const method = request.method();
    if (method !== 'GET') {
      catalogWrites.push({ method, path, body: request.postDataJSON() as unknown });
    }

    if (method === 'GET' && path === 'options') {
      await json(route, CATALOG_OPTIONS);
    } else if (method === 'GET' && path === 'products') {
      const search = url.searchParams.get('search')?.toLowerCase() ?? '';
      const items = products.filter(
        (product) =>
          product.name.toLowerCase().includes(search) || product.sku.toLowerCase().includes(search),
      );
      await json(route, { items, page: 1, pageSize: 20, total: items.length });
    } else if (method === 'POST' && path === 'products') {
      const input = request.postDataJSON() as typeof CEMENT;
      const created = {
        ...input,
        id: String(products.length + 1),
        sku: input.sku.toUpperCase(),
        active: true,
        totalQuantity: 0,
      };
      products.push(created);
      await json(route, { ...created, stockLevels: [] }, 201);
    } else if (method === 'GET' && path === 'stock-movements') {
      await json(route, { items: movements, page: 1, pageSize: 10, total: movements.length });
    } else if (method === 'POST' && path === 'stock-movements') {
      movements.unshift(RECORDED_MOVEMENT.movement);
      await json(route, RECORDED_MOVEMENT, 201);
    } else if (method === 'GET' && path === 'products/1') {
      await json(route, CEMENT_DETAIL);
    } else {
      await json(route, { code: 'NOT_FOUND', message: 'Recurso não encontrado.' }, 404);
    }
  });

  const modes: string[] = [];
  // SQL received by the execution endpoint (what the user approved or edited).
  const executedSql: string[] = [];
  let created = 0;

  await page.route(`**${CONVERSATIONS_PATH}`, async (route) => {
    if (route.request().method() === 'POST') {
      created += 1;
      const conversation: Conversation = {
        id: `00000000-0000-4000-8000-${String(created).padStart(12, '0')}`,
        title: null,
        createdAt: '2026-10-03T10:00:00.000Z',
        updatedAt: '2026-10-03T10:00:00.000Z',
      };
      conversations.unshift(conversation);
      await json(route, conversation, 201);
      return;
    }
    await json(route, { items: conversations });
  });

  await page.route(`**${CONVERSATIONS_PATH}/*/messages`, async (route) => {
    const conversationId = route.request().url().split('/').at(-2) ?? '';
    if (route.request().method() === 'GET') {
      await json(route, { items: options.history?.[conversationId] ?? [] });
      return;
    }

    const body = route.request().postDataJSON() as { question: string; mode?: string };
    questions.push(body.question);
    modes.push(body.mode ?? 'auto');
    const conversation = conversations.find((item) => item.id === conversationId);
    if (conversation && conversation.title === null) {
      conversation.title = body.question;
    }
    await sse(route, answers.shift() ?? []);
  });

  await page.route(`**${CONVERSATIONS_PATH}/*/messages/*/execute`, async (route) => {
    const body = route.request().postDataJSON() as { sql: string };
    executedSql.push(body.sql);
    await sse(route, executions.shift() ?? []);
  });

  return { questions, modes, executedSql, logins, dashboardRequests, catalogWrites };
}
