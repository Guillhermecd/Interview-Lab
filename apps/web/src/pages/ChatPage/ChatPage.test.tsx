import type { Conversation, QueryResult } from '@interview-lab/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeApi,
  jsonResponse,
  openSseResponse,
  sseResponse,
  type StreamEvent,
} from '../../test/fake-api';
import { ChatPage } from './ChatPage';

const CONVERSATION: Conversation = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Quais são as regiões?',
  createdAt: '2026-10-03T10:00:00.000Z',
  updatedAt: '2026-10-03T10:00:00.000Z',
};
const CONVERSATIONS_URL = '/api/conversations';
const MESSAGES_URL = `${CONVERSATIONS_URL}/${CONVERSATION.id}/messages`;

const RESULT: QueryResult = {
  columns: [
    { name: 'regiao', type: 'text' },
    { name: 'pedidos', type: 'int8' },
  ],
  rows: [
    ['Norte', '3920'],
    ['Sul', '4017'],
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 12,
};

const ANSWER: StreamEvent[] = [
  { event: 'sql', data: { sql: 'SELECT regiao, pedidos FROM x', attempt: 1 } },
  {
    event: 'rows',
    data: { result: RESULT, visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' } },
  },
  { event: 'token', data: { text: 'O Sul tem ' } },
  { event: 'token', data: { text: 'mais pedidos.' } },
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

const USAGE = {
  today: { inputTokens: 1200, outputTokens: 300, calls: 4 },
  dailyTokenQuota: 200_000,
  questionsPerMinute: 10,
  byConversation: [],
};

let api: FakeApi;

beforeEach(() => {
  api = new FakeApi();
  vi.stubGlobal('fetch', api.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function askQuestion(question: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Pergunta'), question);
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
}

describe('ChatPage', () => {
  it('shows the empty state with example questions', async () => {
    api.on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [] }));

    render(<ChatPage />);

    expect(await screen.findByText('Nenhuma conversa ainda.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pergunte em português' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Qual foi o faturamento por região no último trimestre?',
      }),
    ).toBeInTheDocument();
  });

  it('creates a conversation on the first question and shows the streamed answer', async () => {
    let listed: Conversation[] = [];
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: listed }))
      .on(`POST ${CONVERSATIONS_URL}`, () => {
        listed = [CONVERSATION];
        return jsonResponse({ ...CONVERSATION, title: null }, 201);
      })
      .on(`POST ${MESSAGES_URL}`, (init) => sseResponse(ANSWER, init.signal));
    render(<ChatPage />);
    await screen.findByText('Nenhuma conversa ainda.');

    await askQuestion('Quais são as regiões?');

    const answer = await screen.findByRole('article', { name: 'Resposta' });
    await within(answer).findByText('O Sul tem mais pedidos.');
    expect(within(answer).getByLabelText('SQL gerado')).toHaveTextContent(
      'SELECT regiao, pedidos FROM x',
    );
    expect(within(answer).getByRole('table')).toHaveTextContent('4.017');
    // What the answer cost, as sent by the server.
    expect(answer).toHaveTextContent('0,01 s');
    expect(answer).toHaveTextContent('2 linhas');
    expect(answer).toHaveTextContent('15 tokens');

    // The chart suggested by the server is on the second tab.
    await userEvent.click(within(answer).getByRole('tab', { name: 'Gráfico' }));
    expect(
      within(answer).getByRole('figure', { name: 'Gráfico de barras: pedidos por regiao' }),
    ).toBeInTheDocument();
    expect(answer).toHaveTextContent('Sugerido: Barras');
    expect(screen.getByText('Quais são as regiões?', { selector: 'main p' })).toBeInTheDocument();
    expect(api.calls.find((call) => call.key === `POST ${MESSAGES_URL}`)?.body).toEqual({
      question: 'Quais são as regiões?',
      mode: 'auto',
    });

    // The list is refreshed once the answer is complete, with the server's title.
    const navigation = screen.getByRole('navigation', { name: 'Conversas' });
    expect(
      await within(navigation).findByRole('button', { name: 'Quais são as regiões?' }),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('shows the error of an error event', async () => {
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
      .on(`GET ${MESSAGES_URL}`, () => jsonResponse({ items: [] }))
      .on(`POST ${MESSAGES_URL}`, () =>
        sseResponse([
          { event: 'sql', data: { sql: 'DELETE FROM regions', attempt: 1 } },
          {
            event: 'error',
            data: {
              code: 'QUERY_REJECTED',
              message: 'A consulta foi recusada pelas regras de segurança.',
              details: [{ field: 'sql', message: 'Apenas consultas SELECT são permitidas.' }],
            },
          },
        ]),
      );
    const user = userEvent.setup();
    render(<ChatPage />);
    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));

    await askQuestion('Apague a região Sul');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A consulta foi recusada pelas regras de segurança.');
    expect(alert).toHaveTextContent('Apenas consultas SELECT são permitidas.');
    // A blocked query cannot be run from the screen.
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
  });

  it('shows a request refused before the stream started', async () => {
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [] }))
      .on(`POST ${CONVERSATIONS_URL}`, () =>
        jsonResponse(
          { code: 'SERVICE_UNAVAILABLE', message: 'Serviço indisponível no momento.' },
          503,
        ),
      );
    render(<ChatPage />);
    await screen.findByText('Nenhuma conversa ainda.');

    await askQuestion('Quantas regiões?');

    expect(await screen.findByRole('alert')).toHaveTextContent('Serviço indisponível no momento.');
  });

  it('loads the history of a conversation chosen in the list', async () => {
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
      .on(`GET ${MESSAGES_URL}`, () =>
        jsonResponse({
          items: [
            {
              id: '1',
              role: 'user',
              content: 'Quais são as regiões?',
              createdAt: '2026-10-03T10:00:00.000Z',
            },
            {
              id: '2',
              role: 'assistant',
              content: 'São cinco regiões.',
              status: 'answered',
              sql: 'SELECT name FROM regions',
              visualization: { type: 'table' },
              rowCount: 5,
              createdAt: '2026-10-03T10:00:01.000Z',
            },
          ],
        }),
      );
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));

    const answer = await screen.findByRole('article', { name: 'Resposta' });
    expect(answer).toHaveTextContent('São cinco regiões.');
    expect(within(answer).getByLabelText('SQL gerado')).toHaveTextContent(
      'SELECT name FROM regions',
    );
    expect(answer).toHaveTextContent('As linhas não ficam salvas no histórico');
  });

  it('shows the error when the history cannot be loaded', async () => {
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
      .on(`GET ${MESSAGES_URL}`, () =>
        jsonResponse({ code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.' }, 500),
      );
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocorreu um erro interno.');
  });

  it('lets the user stop an answer in progress', async () => {
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
      .on(`GET ${MESSAGES_URL}`, () => jsonResponse({ items: [] }))
      .on(`POST ${MESSAGES_URL}`, (init) => {
        if (!init.signal) {
          throw new Error('The answer request must be abortable');
        }
        return openSseResponse(
          [{ event: 'sql', data: { sql: 'SELECT 1', attempt: 1 } }],
          init.signal,
        );
      });
    const user = userEvent.setup();
    render(<ChatPage />);
    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));
    await askQuestion('Pergunta demorada');
    await screen.findByText(/Executando consulta…/);

    await user.click(screen.getByRole('button', { name: 'Parar' }));

    expect(await screen.findByText('Resposta cancelada.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
    });
  });

  it('stops the query from the SQL block while it runs', async () => {
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
      .on(`GET ${MESSAGES_URL}`, () => jsonResponse({ items: [] }))
      .on(`POST ${MESSAGES_URL}`, (init) => {
        if (!init.signal) {
          throw new Error('The answer request must be abortable');
        }
        return openSseResponse(
          [{ event: 'sql', data: { sql: 'SELECT 1', attempt: 1 } }],
          init.signal,
        );
      });
    const user = userEvent.setup();
    render(<ChatPage />);
    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));
    await askQuestion('Pergunta demorada');

    await user.click(await screen.findByRole('button', { name: 'Interromper' }));

    expect(await screen.findByText('Resposta cancelada.')).toBeInTheDocument();
  });

  it('shows the countdown of the rate limit and asks again on request', async () => {
    let refuse = true;
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
      .on(`GET ${MESSAGES_URL}`, () => jsonResponse({ items: [] }))
      .on('GET /api/usage', () => jsonResponse(USAGE))
      .on(`POST ${MESSAGES_URL}`, (init) => {
        if (refuse) {
          refuse = false;
          return jsonResponse(
            { code: 'RATE_LIMITED', message: 'Muitas requisições.', retryAfterSeconds: 42 },
            429,
          );
        }
        return sseResponse(ANSWER, init.signal);
      });
    const user = userEvent.setup();
    render(<ChatPage />);
    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));

    await askQuestion('Quais são as regiões?');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Muitas perguntas em sequência');
    // The limit shown is the one the server reports, not a fixed number.
    expect(alert).toHaveTextContent('O limite é de 10 perguntas por minuto.');
    expect(within(alert).getByRole('timer')).toHaveTextContent('00:42');

    await user.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('O Sul tem mais pedidos.')).toBeInTheDocument();
    expect(
      api.calls.filter((call) => call.key === `POST ${MESSAGES_URL}`).map((call) => call.body),
    ).toEqual([
      { question: 'Quais são as regiões?', mode: 'auto' },
      { question: 'Quais são as regiões?', mode: 'auto' },
    ]);
  });

  it('blocks the composer when the daily quota is over', async () => {
    api
      .on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [CONVERSATION] }))
      .on(`GET ${MESSAGES_URL}`, () => jsonResponse({ items: [] }))
      .on('GET /api/usage', () =>
        jsonResponse({
          ...USAGE,
          today: { inputTokens: 150_000, outputTokens: 50_000, calls: 90 },
        }),
      )
      .on(`POST ${MESSAGES_URL}`, () =>
        jsonResponse(
          {
            code: 'QUOTA_EXCEEDED',
            message: 'A cota diária de uso da IA foi atingida.',
            retryAfterSeconds: 34_020,
          },
          429,
        ),
      );
    const user = userEvent.setup();
    render(<ChatPage />);
    await user.click(await screen.findByRole('button', { name: CONVERSATION.title ?? '' }));

    await askQuestion('Quais são as regiões?');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cota diária de tokens atingida');
    expect(within(alert).getByRole('timer')).toHaveTextContent('9:27:00');
    expect(alert).toHaveTextContent('200.000 / 200.000');
    expect(within(alert).queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(screen.getByLabelText('Pergunta')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('starts with a question brought from another screen, written but not sent', async () => {
    api.on(`GET ${CONVERSATIONS_URL}`, () => jsonResponse({ items: [] }));

    render(<ChatPage initialQuestion="Quais materiais estão abaixo do mínimo?" />);
    await screen.findByText('Nenhuma conversa ainda.');

    expect(screen.getByLabelText('Pergunta')).toHaveValue(
      'Quais materiais estão abaixo do mínimo?',
    );
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    expect(api.calls.some((call) => call.key.startsWith('POST '))).toBe(false);
  });

  it('shows the failure to load the conversation list', async () => {
    api.on(`GET ${CONVERSATIONS_URL}`, () => {
      throw new TypeError('Failed to fetch');
    });

    render(<ChatPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível falar com o servidor. Verifique sua conexão.',
    );
  });
});
