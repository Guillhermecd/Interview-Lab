import type { Conversation, QueryResult } from '@interview-lab/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, jsonResponse, sseResponse } from '../../test/fake-api';
import { ChatPage } from './ChatPage';

const CONVERSATION: Conversation = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Revisão',
  createdAt: '2026-10-03T10:00:00.000Z',
  updatedAt: '2026-10-03T10:00:00.000Z',
};
const CONVERSATIONS_URL = '/api/internal/conversations';
const MESSAGES_URL = `${CONVERSATIONS_URL}/${CONVERSATION.id}/messages`;
const EXECUTE_URL = `${MESSAGES_URL}/7/execute`;
const GENERATED_SQL = 'SELECT name AS regiao FROM regions';

const RESULT: QueryResult = {
  columns: [{ name: 'regiao', type: 'text' }],
  rows: [['Norte'], ['Sul']],
  rowCount: 2,
  truncated: false,
  durationMs: 5,
};

let api: FakeApi;

beforeEach(() => {
  localStorage.clear();
  api = new FakeApi();
  api
    .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
    .on(`GET ${MESSAGES_URL}`, () => jsonResponse({ items: [] }));
  vi.stubGlobal('fetch', api.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openConversationAndAsk(question: string, review: boolean) {
  const user = userEvent.setup();
  render(<ChatPage />);
  await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));
  const toggle = screen.getByRole('checkbox', { name: 'Revisar o SQL antes de executar' });
  if (toggle instanceof HTMLInputElement && toggle.checked !== review) {
    await user.click(toggle);
  }
  await user.type(screen.getByLabelText('Pergunta'), question);
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  return user;
}

describe('review mode', () => {
  it('is off by default and remembers the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ChatPage />);
    const toggle = screen.getByRole('checkbox', { name: 'Revisar o SQL antes de executar' });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    unmount();
    render(<ChatPage />);

    expect(screen.getByRole('checkbox', { name: 'Revisar o SQL antes de executar' })).toBeChecked();
  });

  it('asks in review mode and shows the SQL for approval without running it', async () => {
    api.on(`POST ${MESSAGES_URL}`, (init) =>
      sseResponse(
        [
          { event: 'sql', data: { sql: GENERATED_SQL, attempt: 1 } },
          { event: 'review', data: { messageId: '7', sql: GENERATED_SQL } },
        ],
        init.signal,
      ),
    );

    await openConversationAndAsk('Quais regiões?', true);

    const review = await screen.findByRole('region', { name: 'Revisão do SQL' });
    expect(within(review).getByRole('textbox', { name: 'SQL para revisar' })).toHaveTextContent(
      GENERATED_SQL,
    );
    expect(api.calls.find((call) => call.key === `POST ${MESSAGES_URL}`)?.body).toEqual({
      question: 'Quais regiões?',
      mode: 'review',
    });
    expect(api.calls.some((call) => call.key === `POST ${EXECUTE_URL}`)).toBe(false);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('runs the approved SQL and shows the result', async () => {
    api
      .on(`POST ${MESSAGES_URL}`, (init) =>
        sseResponse(
          [{ event: 'review', data: { messageId: '7', sql: GENERATED_SQL } }],
          init.signal,
        ),
      )
      .on(`POST ${EXECUTE_URL}`, (init) =>
        sseResponse(
          [
            { event: 'rows', data: { result: RESULT, visualization: { type: 'table' } } },
            { event: 'token', data: { text: 'Duas regiões.' } },
            {
              event: 'done',
              data: {
                messageId: '7',
                status: 'answered',
                attempts: 1,
                usage: { inputTokens: 1, outputTokens: 1, calls: 1 },
                edited: false,
              },
            },
          ],
          init.signal,
        ),
      );
    const user = await openConversationAndAsk('Quais regiões?', true);
    await screen.findByRole('region', { name: 'Revisão do SQL' });

    await user.click(screen.getByRole('button', { name: 'Executar' }));

    expect(await screen.findByText('Duas regiões.')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Norte');
    expect(screen.queryByRole('region', { name: 'Revisão do SQL' })).not.toBeInTheDocument();
    expect(api.calls.find((call) => call.key === `POST ${EXECUTE_URL}`)?.body).toEqual({
      sql: GENERATED_SQL,
    });
    expect(screen.queryByText('Editado por você')).not.toBeInTheDocument();
  });

  it('keeps the review open with the reason when the server refuses the SQL', async () => {
    api
      .on(`POST ${MESSAGES_URL}`, (init) =>
        sseResponse(
          [{ event: 'review', data: { messageId: '7', sql: GENERATED_SQL } }],
          init.signal,
        ),
      )
      .on(`POST ${EXECUTE_URL}`, (init) =>
        sseResponse(
          [
            {
              event: 'error',
              data: {
                code: 'QUERY_REJECTED',
                message: 'A consulta foi recusada pelas regras de segurança.',
                details: [{ field: 'sql', message: 'Apenas consultas SELECT são permitidas.' }],
              },
            },
          ],
          init.signal,
        ),
      );
    const user = await openConversationAndAsk('Quais regiões?', true);
    await screen.findByRole('region', { name: 'Revisão do SQL' });

    await user.click(screen.getByRole('button', { name: 'Executar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Apenas consultas SELECT são permitidas.',
    );
    expect(screen.getByRole('region', { name: 'Revisão do SQL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Executar' })).toBeEnabled();
  });

  it('marks an executed SQL that the user edited', async () => {
    api.on(`GET ${MESSAGES_URL}`, () =>
      jsonResponse({
        items: [
          {
            id: '6',
            role: 'user',
            content: 'Quais regiões?',
            createdAt: '2026-10-03T10:00:00.000Z',
          },
          {
            id: '7',
            role: 'assistant',
            content: 'Duas regiões.',
            status: 'answered',
            sql: "SELECT name FROM regions WHERE name LIKE 'N%'",
            generatedSql: GENERATED_SQL,
            edited: true,
            visualization: { type: 'table' },
            rowCount: 2,
            createdAt: '2026-10-03T10:00:01.000Z',
          },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));

    expect(await screen.findByText('Editado por você')).toBeInTheDocument();
    expect(screen.getByText('Ver o SQL gerado originalmente')).toBeInTheDocument();
  });

  it('shows a review left pending in the history, ready to run', async () => {
    api.on(`GET ${MESSAGES_URL}`, () =>
      jsonResponse({
        items: [
          {
            id: '6',
            role: 'user',
            content: 'Quais regiões?',
            createdAt: '2026-10-03T10:00:00.000Z',
          },
          {
            id: '7',
            role: 'assistant',
            content: '',
            status: 'pending_review',
            sql: GENERATED_SQL,
            createdAt: '2026-10-03T10:00:01.000Z',
          },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));

    expect(await screen.findByRole('region', { name: 'Revisão do SQL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Executar' })).toBeEnabled();
  });
});

describe('leaving while a new conversation is being created', () => {
  it('does not pull the user back to the conversation created meanwhile', async () => {
    let releaseCreate: (() => void) | undefined;
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
      .on(
        `POST ${CONVERSATIONS_URL}`,
        () =>
          new Promise<Response>((resolve) => {
            releaseCreate = () => {
              resolve(
                jsonResponse(
                  { ...CONVERSATION, id: '33333333-3333-4333-8333-333333333333', title: null },
                  201,
                ),
              );
            };
          }),
      );
    const user = userEvent.setup();
    render(<ChatPage />);
    await screen.findByRole('button', { name: CONVERSATION.title ?? '' });
    await user.type(screen.getByLabelText('Pergunta'), 'Pergunta nova');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    // While the conversation is still being created, the user opens another one.
    await user.click(screen.getByRole('button', { name: CONVERSATION.title ?? '' }));
    releaseCreate?.();

    await screen.findByRole('heading', { name: 'Pergunte em português' });
    const navigation = screen.getByRole('navigation', { name: 'Conversas' });
    expect(
      within(navigation).getByRole('button', { name: CONVERSATION.title ?? '' }),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      api.calls.some((call) => call.key.startsWith('POST /api/internal/conversations/33')),
    ).toBe(false);
  });
});
