import type { ConversationMessage, QueryResult } from '@interview-lab/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { stubCatalog } from './test/catalog-fixtures';
import { stubDashboard } from './test/dashboard-fixtures';
import {
  FakeApi,
  jsonResponse,
  openSseResponse,
  sseResponse,
  TEST_ADMIN,
  TEST_USER,
  type StreamEvent,
} from './test/fake-api';

const WINDOW = 'Converse com seus dados';
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATIONS_URL = '/api/conversations';
const MESSAGES_URL = `${CONVERSATIONS_URL}/${CONVERSATION_ID}/messages`;
const CONVERSATION = {
  id: CONVERSATION_ID,
  title: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
};
const USAGE = {
  today: { inputTokens: 1200, outputTokens: 300, calls: 4 },
  dailyTokenQuota: 200_000,
  level: 'normal' as const,
  questionsPerMinute: 10,
  byConversation: [],
};

const RESULT: QueryResult = {
  columns: [
    { name: 'material', type: 'text' },
    { name: 'saldo', type: 'int8' },
  ],
  rows: [['Vergalhão CA-50 10 mm', '120']],
  rowCount: 1,
  truncated: false,
  durationMs: 12,
};
const SQL: StreamEvent = {
  event: 'sql',
  data: { sql: 'SELECT material, saldo FROM x', attempt: 1 },
};
const ANSWER: StreamEvent[] = [
  SQL,
  { event: 'rows', data: { result: RESULT, visualization: { type: 'table' } } },
  { event: 'token', data: { text: 'Um material está abaixo do mínimo.' } },
  {
    event: 'done',
    data: {
      messageId: '2',
      status: 'answered',
      attempts: 1,
      usage: { inputTokens: 10, outputTokens: 5, calls: 2 },
    },
  },
];
const ANSWER_TEXT = 'Um material está abaixo do mínimo.';
const ALERTS_QUESTION = 'Quais materiais estão abaixo do estoque mínimo?';

let api: FakeApi;

beforeEach(() => {
  api = new FakeApi();
  vi.stubGlobal('fetch', api.fetch);
  stubDashboard(api)
    .on('GET /api/auth/me', () => jsonResponse(TEST_USER))
    .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [] }))
    .on('GET /api/usage', () => jsonResponse(USAGE))
    .on(`POST ${CONVERSATIONS_URL}`, () => jsonResponse(CONVERSATION, 201))
    .on(`POST ${MESSAGES_URL}`, (init) => sseResponse(ANSWER, init.signal));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

// The screens and the window are loaded on demand; loading them once here
// keeps that first load out of the time each test waits.
beforeAll(async () => {
  await Promise.all([
    import('./pages/DashboardPage'),
    import('./pages/ChatPage'),
    import('./pages/CatalogPage'),
    import('./pages/ChatPage/FloatingChatWindow'),
  ]);
});

function renderApp(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function openFromButton(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: WINDOW }));
  return screen.findByRole('dialog', { name: WINDOW });
}

async function openFromAlertsCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Perguntar sobre isto: Alertas de ruptura' }),
  );
  return screen.findByRole('dialog', { name: WINDOW });
}

function questionsSent(): unknown[] {
  return api.calls.filter((call) => call.key === `POST ${MESSAGES_URL}`).map((call) => call.body);
}

describe('floating chat', () => {
  it('opens from the floating button with suggestions, over the dashboard', async () => {
    const user = userEvent.setup();
    renderApp();

    const dialog = await openFromButton(user);

    expect(within(dialog).getByLabelText('Pergunta')).toHaveFocus();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4);
    expect(within(dialog).queryByText(/^Contexto:/)).not.toBeInTheDocument();
    // The window floats: the dashboard is still there, and the button is gone.
    expect(screen.getByRole('heading', { name: 'Operações e vendas' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: WINDOW })).toEqual([
      within(dialog).getByRole('button', { name: WINDOW }),
    ]);
  });

  it('answers a suggestion inside the window', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromButton(user);

    await user.click(within(dialog).getByRole('button', { name: ALERTS_QUESTION }));

    expect(await within(dialog).findByText(ANSWER_TEXT)).toBeInTheDocument();
    expect(within(dialog).getByText(ALERTS_QUESTION)).toBeInTheDocument();
    expect(questionsSent()).toEqual([{ question: ALERTS_QUESTION, mode: 'auto' }]);
  });

  it('opens from a card with the context and the question written, not sent', async () => {
    const user = userEvent.setup();
    renderApp();

    const dialog = await openFromAlertsCard(user);

    expect(within(dialog).getByText('Contexto: Alertas de ruptura')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Pergunta')).toHaveValue(ALERTS_QUESTION);
    expect(within(dialog).getByLabelText('Pergunta')).toHaveFocus();
    expect(api.calls.some((call) => call.key.startsWith('POST '))).toBe(false);
    expect(screen.getByRole('heading', { name: 'Operações e vendas' })).toBeInTheDocument();
  });

  it('sends the context inside the question and drops the chip', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromAlertsCard(user);

    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));

    expect(await within(dialog).findByText(ANSWER_TEXT)).toBeInTheDocument();
    expect(questionsSent()).toEqual([
      { question: `${ALERTS_QUESTION} (Contexto: Alertas de ruptura)`, mode: 'auto' },
    ]);
    expect(
      within(dialog).getByText(`${ALERTS_QUESTION} (Contexto: Alertas de ruptura)`),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Contexto: Alertas de ruptura')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Pergunta')).toHaveValue('');
  });

  it('sends the question alone once the context is removed', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromAlertsCard(user);

    await user.click(within(dialog).getByRole('button', { name: 'Remover contexto' }));

    expect(within(dialog).queryByText('Contexto: Alertas de ruptura')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Pergunta')).toHaveValue(ALERTS_QUESTION);

    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));

    await within(dialog).findByText(ANSWER_TEXT);
    expect(questionsSent()).toEqual([{ question: ALERTS_QUESTION, mode: 'auto' }]);
  });

  it('rewrites the composer when another card asks, keeping the conversation', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromAlertsCard(user);
    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await within(dialog).findByText(ANSWER_TEXT);

    await user.click(
      screen.getByRole('button', { name: 'Perguntar sobre isto: Curva ABC dos materiais' }),
    );

    expect(within(dialog).getByText('Contexto: Curva ABC · 12 meses')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Pergunta')).toHaveValue(
      'Quais materiais concentram a maior parte do faturamento dos últimos 12 meses?',
    );
    expect(within(dialog).getByText(ANSWER_TEXT)).toBeInTheDocument();
    expect(questionsSent()).toHaveLength(1);
  });

  it('follows the review preference', async () => {
    api.on(`POST ${MESSAGES_URL}`, (init) =>
      sseResponse(
        [
          SQL,
          {
            event: 'review',
            data: { messageId: '2', sql: 'SELECT material, saldo FROM x', tables: ['x'] },
          },
        ],
        init.signal,
      ),
    );
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromAlertsCard(user);

    await user.click(within(dialog).getByRole('switch', { name: 'Revisar SQL antes de executar' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));

    expect(
      await within(dialog).findByRole('button', { name: 'Aprovar e executar' }),
    ).toBeInTheDocument();
    expect(questionsSent()).toEqual([
      { question: `${ALERTS_QUESTION} (Contexto: Alertas de ruptura)`, mode: 'review' },
    ]);
  });

  it('keeps the conversation and what was typed while minimized', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromButton(user);
    await user.click(within(dialog).getByRole('button', { name: ALERTS_QUESTION }));
    await within(dialog).findByText(ANSWER_TEXT);
    await user.type(within(dialog).getByLabelText('Pergunta'), 'E por centro?');

    await user.click(within(dialog).getByRole('button', { name: 'Minimizar' }));

    expect(within(dialog).getByRole('button', { name: 'Restaurar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(dialog).getByText(ANSWER_TEXT)).not.toBeVisible();
    expect(within(dialog).queryByRole('textbox', { name: 'Pergunta' })).not.toBeInTheDocument();

    // The title restores it too.
    await user.click(within(dialog).getByRole('button', { name: WINDOW }));

    expect(within(dialog).getByText(ANSWER_TEXT)).toBeVisible();
    expect(within(dialog).getByLabelText('Pergunta')).toHaveValue('E por centro?');
  });

  it('opens a minimized window again when a card asks', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromButton(user);
    await user.click(within(dialog).getByRole('button', { name: 'Minimizar' }));

    await openFromAlertsCard(user);

    expect(within(dialog).getByLabelText('Pergunta')).toHaveValue(ALERTS_QUESTION);
  });

  it('starts over after being closed', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromAlertsCard(user);
    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await within(dialog).findByText(ANSWER_TEXT);

    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));

    expect(screen.queryByRole('dialog', { name: WINDOW })).not.toBeInTheDocument();
    const reopened = await openFromButton(user);
    expect(within(reopened).queryByText(ANSWER_TEXT)).not.toBeInTheDocument();
    expect(within(reopened).getByLabelText('Pergunta')).toHaveValue('');
    expect(within(reopened).getAllByRole('listitem')).toHaveLength(4);
  });

  it('does not exist on the chat screen, and going there closes it', async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromButton(user);

    await user.click(screen.getByRole('link', { name: WINDOW }));

    await screen.findByRole('heading', { name: 'O que você quer saber sobre a operação?' });
    expect(screen.queryByRole('dialog', { name: WINDOW })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WINDOW })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Dashboard' }));

    expect(await screen.findByRole('button', { name: WINDOW })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: WINDOW })).not.toBeInTheDocument();
  });

  it('keeps the conversation between the dashboard and the registry', async () => {
    stubCatalog(api).on('GET /api/auth/me', () => jsonResponse(TEST_ADMIN));
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromButton(user);
    await user.click(within(dialog).getByRole('button', { name: ALERTS_QUESTION }));
    await within(dialog).findByText(ANSWER_TEXT);

    await user.click(screen.getByRole('link', { name: 'Cadastro' }));

    expect(await screen.findByRole('heading', { name: 'Cadastro' })).toBeInTheDocument();
    expect(within(dialog).getByText(ANSWER_TEXT)).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it('keeps an answer in progress while moving to the registry', async () => {
    stubCatalog(api)
      .on('GET /api/auth/me', () => jsonResponse(TEST_ADMIN))
      .on(`POST ${MESSAGES_URL}`, (init) =>
        openSseResponse([SQL], init.signal ?? new AbortController().signal),
      );
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromButton(user);
    await user.click(within(dialog).getByRole('button', { name: ALERTS_QUESTION }));
    await within(dialog).findByRole('button', { name: 'Parar' });

    await user.click(screen.getByRole('link', { name: 'Cadastro' }));
    await screen.findByRole('heading', { name: 'Cadastro' });

    expect(within(dialog).getByRole('button', { name: 'Parar' })).toBeInTheDocument();
    // Going to the chat screen would stop the answer: not offered meanwhile.
    expect(within(dialog).getByRole('button', { name: 'Tela cheia' })).toBeDisabled();
  });

  it('opens the same conversation in the chat screen with "Tela cheia"', async () => {
    const history: ConversationMessage[] = [];
    api.on(`GET ${MESSAGES_URL}`, () => jsonResponse({ items: history }));
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromButton(user);
    await user.click(within(dialog).getByRole('button', { name: ALERTS_QUESTION }));
    await within(dialog).findByText(ANSWER_TEXT);
    api.on(`GET ${CONVERSATIONS_URL}`, () =>
      jsonResponse({ items: [{ ...CONVERSATION, title: ALERTS_QUESTION }] }),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Tela cheia' }));

    expect(await screen.findByRole('heading', { name: ALERTS_QUESTION })).toBeInTheDocument();
    await waitFor(() => {
      expect(api.calls.some((call) => call.key === `GET ${MESSAGES_URL}`)).toBe(true);
    });
    expect(screen.queryByRole('dialog', { name: WINDOW })).not.toBeInTheDocument();
  });

  it('goes to an empty chat screen with "Tela cheia" before any question', async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromButton(user);

    await user.click(within(dialog).getByRole('button', { name: 'Tela cheia' }));

    expect(
      await screen.findByRole('heading', { name: 'O que você quer saber sobre a operação?' }),
    ).toBeInTheDocument();
    expect(api.calls.some((call) => call.key.startsWith('POST '))).toBe(false);
  });
});
