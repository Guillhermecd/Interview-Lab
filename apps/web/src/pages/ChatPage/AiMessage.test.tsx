import type { QueryResult, UsageSummary } from '@interview-lab/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AiMessage } from './AiMessage';
import type { AnswerItem } from './chat-state';

const SQL = 'SELECT regiao, pedidos FROM x';

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
  durationMs: 1840,
};

const EMPTY_RESULT: QueryResult = { ...RESULT, rows: [], rowCount: 0 };

const USAGE: UsageSummary = {
  today: { inputTokens: 150_000, outputTokens: 50_000, calls: 90 },
  dailyTokenQuota: 200_000,
  level: 'normal' as const,
  questionsPerMinute: 10,
  byConversation: [],
};

// Every frame of the states board is an answer in a given shape: the state is
// forced by building that shape, never by a flag of the component.
function answer(overrides: Partial<AnswerItem>): AnswerItem {
  return {
    kind: 'answer',
    id: 'a-1',
    status: 'streaming',
    time: '2026-10-05T14:32:00.000Z',
    sqlAttempts: [],
    explanation: '',
    fromHistory: false,
    ...overrides,
  };
}

function setup(item: AnswerItem, isBusy = false) {
  const handlers = {
    onExecuteReview: vi.fn(),
    onEditReview: vi.fn(),
    onCancelReview: vi.fn(),
    onReopenReview: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
  };
  render(<AiMessage answer={item} isBusy={isBusy} usage={USAGE} {...handlers} />);
  return { handlers, user: userEvent.setup(), message: screen.getByRole('article') };
}

function currentStep(): string | undefined {
  return (
    screen.getByRole('list', { name: 'Etapas da resposta' }).querySelector('[aria-current]')
      ?.textContent ?? undefined
  );
}

describe('AiMessage states', () => {
  it('generating: the SQL is being written', () => {
    const { message } = setup(answer({}));

    expect(message).toHaveAttribute('aria-busy', 'true');
    expect(currentStep()).toBe('SQL');
    expect(screen.getByText('Gerando')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('review: waits for approval and runs nothing by itself', async () => {
    const { handlers, user } = setup(
      answer({ status: 'pending_review', messageId: '7', sqlAttempts: [SQL], reviewSql: SQL }),
    );

    expect(currentStep()).toBe('Aguardando revisão');
    expect(handlers.onExecuteReview).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Aprovar e executar' }));

    expect(handlers.onExecuteReview).toHaveBeenCalledWith('a-1', '7', SQL);
  });

  it('review with an edited SQL: marked as edited and sent as edited', async () => {
    const edited = `${SQL} LIMIT 1`;
    const { handlers, user } = setup(
      answer({
        status: 'pending_review',
        messageId: '7',
        sqlAttempts: [SQL],
        reviewSql: SQL,
        reviewDraft: edited,
      }),
    );

    expect(screen.getByText('Editado por você')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aprovar e executar' }));
    expect(handlers.onExecuteReview).toHaveBeenCalledWith('a-1', '7', edited);

    await user.click(screen.getByRole('button', { name: 'Desfazer edição' }));
    expect(handlers.onEditReview).toHaveBeenCalledWith('a-1', undefined);
  });

  it('review: cannot be approved while another answer is in progress', () => {
    setup(
      answer({ status: 'pending_review', messageId: '7', sqlAttempts: [SQL], reviewSql: SQL }),
      true,
    );

    expect(screen.getByRole('button', { name: 'Aprovar e executar' })).toBeDisabled();
  });

  it('cancelled review: nothing ran, and it can be reviewed again', async () => {
    const { handlers, user } = setup(
      answer({ status: 'cancelled', messageId: '7', sqlAttempts: [SQL], reviewSql: SQL }),
    );

    expect(currentStep()).toBe('Cancelado');
    expect(
      screen.getByText('Você cancelou a execução. Nada foi consultado no banco.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revisar de novo' }));

    expect(handlers.onReopenReview).toHaveBeenCalledWith('a-1');
  });

  it('running: shows the clock and can be interrupted', async () => {
    const { handlers, user } = setup(answer({ sqlAttempts: [SQL] }));

    expect(currentStep()).toBe('Execução');
    expect(screen.getByText(/Executando consulta…/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Interromper' }));

    expect(handlers.onStop).toHaveBeenCalledOnce();
  });

  it('streaming: the result is there and the explanation is being written', () => {
    const { message } = setup(
      answer({
        sqlAttempts: [SQL],
        result: RESULT,
        visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' },
        explanation: 'O Sul tem',
      }),
    );

    expect(currentStep()).toBe('Explicação');
    expect(screen.getByRole('table')).toHaveTextContent('4.017');
    expect(message).toHaveTextContent('O Sul tem');
    // Tokens are only known when the answer ends: no number is shown before.
    expect(message).not.toHaveTextContent('tokens');
  });

  it('done: shows what the answer cost', () => {
    const { message } = setup(
      answer({
        status: 'answered',
        messageId: '7',
        sqlAttempts: [SQL],
        result: RESULT,
        visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' },
        explanation: 'O Sul tem mais pedidos.',
        usage: { inputTokens: 2000, outputTokens: 318, calls: 2 },
        cached: false,
      }),
    );

    expect(message).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText('Validado')).toBeInTheDocument();
    expect(message).toHaveTextContent('1,84 s');
    expect(message).toHaveTextContent('2 linhas');
    expect(message).toHaveTextContent('2.318 tokens');
    expect(screen.queryByText('Resposta do cache')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('done from the cache: says so', () => {
    setup(
      answer({
        status: 'answered',
        sqlAttempts: [SQL],
        result: RESULT,
        explanation: 'O Sul tem mais pedidos.',
        usage: { inputTokens: 400, outputTokens: 12, calls: 1 },
        cached: true,
      }),
    );

    expect(screen.getByText('Resposta do cache')).toBeInTheDocument();
  });

  it('blocked: explains why and cannot be run', () => {
    const { message } = setup(
      answer({
        status: 'error',
        sqlAttempts: ['DELETE FROM regions'],
        error: {
          code: 'QUERY_REJECTED',
          message: 'A consulta foi recusada pelas regras de segurança.',
          details: [{ field: 'sql', message: 'Apenas consultas SELECT são permitidas.' }],
        },
      }),
    );

    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Consulta bloqueada pela validação de segurança');
    expect(alert).toHaveTextContent('Apenas consultas SELECT são permitidas.');
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    expect(message).toHaveTextContent('não executada');
  });

  it('timeout: warns and offers to try again', async () => {
    const { handlers, user, message } = setup(
      answer({
        status: 'error',
        sqlAttempts: [SQL],
        error: { code: 'QUERY_TIMEOUT', message: 'A consulta excedeu o tempo limite.' },
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('A consulta excedeu o tempo limite.');
    expect(message).toHaveTextContent('tempo limite');

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it('empty: the query ran and returned no rows', () => {
    const { message } = setup(
      answer({
        status: 'answered',
        sqlAttempts: [SQL],
        result: EMPTY_RESULT,
        explanation: 'Nenhum pedido atende ao filtro.',
        usage: { inputTokens: 1000, outputTokens: 132, calls: 2 },
      }),
    );

    expect(screen.getByText('Nenhuma linha retornada')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Colunas da consulta' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['regiao', 'pedidos']);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(message).toHaveTextContent('0 linhas');
    expect(message).toHaveTextContent('Nenhum pedido atende ao filtro.');
  });

  it('rate limit: shows the limit and the time left, as sent by the server', () => {
    setup(
      answer({
        status: 'error',
        error: { code: 'RATE_LIMITED', message: 'Muitas requisições.', retryAfterSeconds: 42 },
      }),
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Muitas perguntas em sequência');
    expect(alert).toHaveTextContent('O limite é de 10 perguntas por minuto.');
    expect(alert).toHaveTextContent('Libera em');
    expect(within(alert).getByRole('timer')).toHaveTextContent('00:42');
    expect(screen.queryByRole('list', { name: 'Etapas da resposta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Consulta SQL' })).not.toBeInTheDocument();
  });

  it('quota: shows the usage, when it renews, and no way to insist', () => {
    setup(
      answer({
        status: 'error',
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'A cota diária de uso da IA foi atingida.',
          retryAfterSeconds: 34_020,
        },
      }),
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Cota diária de tokens atingida');
    expect(alert).toHaveTextContent('Renova em');
    expect(within(alert).getByRole('timer')).toHaveTextContent('9:27:00');
    expect(alert).toHaveTextContent('200.000 / 200.000');
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
  });

  it('not answerable: shows only the reason given by the AI', () => {
    const { message } = setup(
      answer({ status: 'not_answerable', explanation: 'Não há dados de estoque.' }),
    );

    expect(message).toHaveTextContent('Não há dados de estoque.');
    expect(screen.queryByRole('region', { name: 'Consulta SQL' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('from the history: no steps, and says the rows are not stored', () => {
    const { message } = setup(
      answer({
        status: 'answered',
        fromHistory: true,
        messageId: '2',
        sqlAttempts: [SQL],
        explanation: 'São cinco regiões.',
        rowCount: 5,
      }),
    );

    expect(screen.queryByRole('list', { name: 'Etapas da resposta' })).not.toBeInTheDocument();
    expect(message).toHaveTextContent('As linhas não ficam salvas no histórico');
    expect(message).toHaveTextContent('5 linhas');
  });
});
