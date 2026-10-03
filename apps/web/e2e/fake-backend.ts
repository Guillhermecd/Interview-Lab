import type {
  AnswerStreamEventName,
  AnswerStreamEvents,
  Conversation,
  ConversationMessage,
} from '@interview-lab/shared';
import type { Page, Route } from '@playwright/test';

export type StreamEvent = {
  [Name in AnswerStreamEventName]: { event: Name; data: AnswerStreamEvents[Name] };
}[AnswerStreamEventName];

const CONVERSATIONS_PATH = '/api/internal/conversations';

interface FakeBackendOptions {
  conversations?: Conversation[];
  history?: Record<string, ConversationMessage[]>;
  // The events answered to the next question, in order of the questions.
  answers?: StreamEvent[][];
  // The events answered to the next execution of a reviewed SQL.
  executions?: StreamEvent[][];
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

  return { questions, modes, executedSql };
}
