import type { UsageSummary } from '@interview-lab/shared';
import { useEffect, useState } from 'react';
import { Alert, type AlertVariant } from '../../components/Alert';
import { ResultPanel } from '../../components/ResultPanel';
import { SqlBlock } from '../../components/SqlBlock';
import { SqlEditor } from '../../components/SqlEditor';
import { Button } from '../../components/ui/Button';
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DatabaseIcon,
  HexagonIcon,
  RowsIcon,
  TableIcon,
  ZapIcon,
} from '../../components/ui/icons';
import {
  formatDuration,
  formatElapsed,
  formatInteger,
  formatRowCount,
  formatTime,
} from '../../utils/format';
import type { AnswerError, AnswerItem } from './chat-state';
import {
  messageState,
  messageSteps,
  sqlBlockView,
  type MessageState,
  type MessageStep,
  type StepStatus,
} from './message-state';

interface AiMessageProps {
  answer: AnswerItem;
  // Disables actions while another answer is streaming.
  isBusy: boolean;
  // Limits and today's usage, as reported by the server; shown in limit alerts.
  usage?: UsageSummary | undefined;
  onExecuteReview: (answerId: string, messageId: string, sql: string) => void;
  onEditReview: (answerId: string, sql: string | undefined) => void;
  onCancelReview: (answerId: string) => void;
  onReopenReview: (answerId: string) => void;
  // Stops the answer in progress.
  onStop: () => void;
  // Asks the same question again; absent when that is not possible.
  onRetry?: (() => void) | undefined;
}

const RETRY_ACTION = 'Tentar novamente';
const ELAPSED_TICK_MS = 100;

const STEP_CLASSES: Record<StepStatus, string> = {
  done: 'text-text-2',
  current: 'bg-accent-soft text-accent-text',
  error: 'bg-crit-soft text-crit',
  todo: 'text-text-3',
};

const SKELETON_ROWS = ['w-[92%]', 'w-[78%] opacity-80', 'w-[85%] opacity-60', 'w-[60%] opacity-40'];

// Time since `active` became true, for the clock of a query in progress.
function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, ELAPSED_TICK_MS);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [active]);

  return elapsed;
}

function Steps({ steps }: { steps: MessageStep[] }) {
  return (
    <ol aria-label="Etapas da resposta" className="flex flex-wrap items-center gap-1">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden="true" className="h-px w-2.5 bg-line-2" />}
          <span
            aria-current={step.status === 'current' ? 'step' : undefined}
            className={`inline-flex h-[22px] items-center gap-[5px] rounded-full px-[7px] text-[11.5px] font-medium ${STEP_CLASSES[step.status]}`}
          >
            {step.status === 'done' && <CheckIcon size={10} strokeWidth={2.2} />}
            {step.status === 'error' && <CloseIcon size={10} strokeWidth={2.2} />}
            {step.status === 'current' && (
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 animate-soft-pulse rounded-full bg-current"
              />
            )}
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface AlertContent {
  variant: AlertVariant;
  title: string;
  body: string;
  details: string[];
  countdown?: number | undefined;
  countdownLabel?: string;
  meterUsed?: number;
  meterTotal?: number;
  retry: boolean;
}

// How each failure is announced. The decision is made by the error code the
// server sent; the numbers shown are the server's too.
function alertContent(
  state: MessageState,
  error: AnswerError,
  usage: UsageSummary | undefined,
): AlertContent {
  const details = error.details?.map((detail) => detail.message) ?? [];
  const code = error.code;

  if (code === 'RATE_LIMITED') {
    return {
      variant: 'warn',
      title: 'Muitas perguntas em sequência',
      body: usage
        ? `${error.message} O limite é de ${formatInteger(usage.questionsPerMinute)} perguntas por minuto.`
        : error.message,
      details,
      countdown: error.retryAfterSeconds,
      countdownLabel: 'Libera em',
      retry: true,
    };
  }
  if (code === 'QUOTA_EXCEEDED') {
    return {
      variant: 'crit',
      title: 'Cota diária de tokens atingida',
      body: error.message,
      details,
      countdown: error.retryAfterSeconds,
      countdownLabel: 'Renova em',
      ...(usage && {
        meterUsed: usage.today.inputTokens + usage.today.outputTokens,
        meterTotal: usage.dailyTokenQuota,
      }),
      retry: false,
    };
  }
  // Another question of the same user is still running (another tab, or the
  // floating window). Nothing to count down: it frees when that one ends.
  if (code === 'EXECUTION_IN_PROGRESS') {
    return {
      variant: 'warn',
      title: 'Outra pergunta sua ainda está em andamento',
      body: error.message,
      details,
      retry: true,
    };
  }
  if (code === 'QUERY_TIMEOUT') {
    return {
      variant: 'warn',
      title: error.message,
      body: 'Perguntas mais específicas (um período menor, menos tabelas) costumam terminar a tempo.',
      details,
      retry: true,
    };
  }
  if (state === 'blocked' || code === 'QUERY_REJECTED' || code === 'QUERY_NOT_ALLOWED') {
    return {
      variant: 'crit',
      title: 'Consulta bloqueada pela validação de segurança',
      body: `${error.message} Nada foi alterado no banco.`,
      details,
      retry: false,
    };
  }
  return { variant: 'crit', title: error.message, body: '', details, retry: code !== undefined };
}

// One answer of the assistant: the steps it is going through, the SQL (with
// review when asked), the result as table or chart, the explanation as it is
// written, and what it cost.
export function AiMessage({
  answer,
  isBusy,
  usage,
  onExecuteReview,
  onEditReview,
  onCancelReview,
  onReopenReview,
  onStop,
  onRetry,
}: AiMessageProps) {
  const state = messageState(answer);
  const steps = answer.fromHistory ? [] : messageSteps(answer);
  const sqlView = sqlBlockView(answer);
  const elapsed = useElapsed(state === 'running');
  const { messageId, result } = answer;
  const isStreaming = answer.status === 'streaming';
  const canReopen = answer.reviewSql !== undefined && messageId !== undefined;

  const alert = answer.error ? alertContent(state, answer.error, usage) : undefined;
  const canRetry = alert?.retry === true && state !== 'review' && onRetry !== undefined;

  const rowCount = result?.rowCount ?? answer.rowCount;
  const tokens = answer.usage && answer.usage.inputTokens + answer.usage.outputTokens;
  const metaTime =
    state === 'blocked'
      ? 'não executada'
      : state === 'timeout'
        ? 'tempo limite'
        : result && formatDuration(result.durationMs);
  const showMeta =
    (state === 'done' || state === 'empty' || state === 'timeout' || state === 'blocked') &&
    (metaTime !== undefined || rowCount !== undefined || tokens !== undefined);

  return (
    <article aria-label="Resposta" aria-busy={isStreaming} className="flex min-w-0 gap-3">
      <div
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-accent-soft text-accent-text"
      >
        <DatabaseIcon size={15} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <header className="flex min-h-7 flex-wrap items-center gap-x-3.5 gap-y-2">
          <p className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold">Assistente de dados</span>
            <time dateTime={answer.time} className="text-xs text-text-3">
              {formatTime(answer.time)}
            </time>
          </p>
          {steps.length > 0 && <Steps steps={steps} />}
        </header>

        {answer.sqlAttempts.length > 1 && (
          <p className="text-xs text-text-2">
            A primeira consulta foi recusada; abaixo, a segunda tentativa.
          </p>
        )}

        {sqlView && (
          <SqlBlock
            sql={sqlView.sql}
            mode={sqlView.mode}
            status={sqlView.status}
            edited={sqlView.edited}
            disabled={isBusy}
            elapsed={state === 'running' ? formatElapsed(elapsed) : undefined}
            {...(state === 'review' &&
              messageId !== undefined && {
                onApprove: ({ sql }) => {
                  onExecuteReview(answer.id, messageId, sql);
                },
                onEdit: (sql: string) => {
                  onEditReview(answer.id, sql);
                },
                onUndoEdit: () => {
                  onEditReview(answer.id, undefined);
                },
                onCancel: () => {
                  onCancelReview(answer.id);
                },
              })}
            {...(state === 'running' && { onCancel: onStop })}
          />
        )}

        {answer.edited === true && answer.generatedSql !== undefined && (
          <details className="text-xs text-text-2">
            <summary className="cursor-pointer">Ver o SQL gerado originalmente</summary>
            <div className="mt-1.5 overflow-hidden rounded-lg border border-line">
              <SqlEditor value={answer.generatedSql} label="SQL gerado originalmente" />
            </div>
          </details>
        )}

        {state === 'generating' && (
          <p role="status" className="text-[12.5px] text-text-2">
            Gerando o SQL…
          </p>
        )}

        {state === 'cancelled' &&
          (canReopen ? (
            <p className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-text-2">
              Você cancelou a execução. Nada foi consultado no banco.
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onReopenReview(answer.id);
                }}
              >
                Revisar de novo
              </Button>
            </p>
          ) : (
            <p className="text-[12.5px] text-text-2">Resposta cancelada.</p>
          ))}

        {state === 'running' && (
          <div
            aria-hidden="true"
            className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
          >
            <div className="flex gap-1.5">
              <div className="h-[22px] w-16 rounded-[5px] bg-surface-3" />
              <div className="h-[22px] w-16 rounded-[5px] bg-surface-2" />
            </div>
            {SKELETON_ROWS.map((width) => (
              <div key={width} className={`h-3.5 rounded-[3px] bg-surface-3 ${width}`} />
            ))}
          </div>
        )}

        {result && result.rowCount > 0 && (
          <ResultPanel result={result} visualization={answer.visualization} />
        )}

        {result?.rowCount === 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-dashed border-line-2 bg-surface px-4 py-[18px]">
            <div
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-text-2"
            >
              <TableIcon size={16} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[13.5px] font-semibold">Nenhuma linha retornada</p>
              <p className="text-[13px] text-text-2">
                A consulta rodou sem erros, mas nenhum registro atende aos filtros.
              </p>
              <ul aria-label="Colunas da consulta" className="mt-0.5 flex flex-wrap gap-1">
                {result.columns.map((column, index) => (
                  <li
                    key={`${column.name}-${String(index)}`}
                    className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-text-3"
                  >
                    {column.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {alert && (
          <Alert
            variant={alert.variant}
            title={alert.title}
            body={
              (alert.body !== '' || alert.details.length > 0) && (
                <>
                  {alert.body !== '' && <p>{alert.body}</p>}
                  {alert.details.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">
                      {alert.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </>
              )
            }
            countdown={alert.countdown}
            {...(alert.countdownLabel !== undefined && { countdownLabel: alert.countdownLabel })}
            meterUsed={alert.meterUsed}
            meterTotal={alert.meterTotal}
            actions={canRetry ? [RETRY_ACTION] : []}
            onAction={() => {
              onRetry?.();
            }}
          />
        )}

        {answer.explanation !== '' && (
          <p
            aria-live="polite"
            className="max-w-[74ch] text-sm leading-[1.62] text-pretty whitespace-pre-wrap"
          >
            {answer.explanation}
            {state === 'streaming' && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-[1.1em] w-[7px] animate-blink bg-accent align-[-2px]"
              />
            )}
          </p>
        )}

        {answer.fromHistory && answer.status === 'answered' && answer.rowCount !== undefined && (
          <p className="text-xs text-text-3">
            As linhas não ficam salvas no histórico; faça a pergunta de novo para vê-las.
          </p>
        )}

        {showMeta && (
          <dl className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11.5px] text-text-3">
            {metaTime !== undefined && (
              <div className="inline-flex items-center gap-[5px]">
                <ClockIcon size={12} />
                <dt className="sr-only">Tempo da consulta</dt>
                <dd className={`font-mono ${state === 'timeout' ? 'text-warn' : ''}`}>
                  {metaTime}
                </dd>
              </div>
            )}
            {rowCount !== undefined && (
              <div className="inline-flex items-center gap-[5px]">
                <RowsIcon size={12} />
                <dt className="sr-only">Linhas</dt>
                <dd className="font-mono">{formatRowCount(rowCount)}</dd>
              </div>
            )}
            {tokens !== undefined && (
              <div className="inline-flex items-center gap-[5px]">
                <HexagonIcon size={12} />
                <dt className="sr-only">Tokens usados</dt>
                <dd className="font-mono">{formatInteger(tokens)} tokens</dd>
              </div>
            )}
            {answer.cached === true && (
              <div className="inline-flex h-5 items-center gap-1 rounded bg-accent-soft px-[7px] font-semibold text-accent-text">
                <ZapIcon size={11} />
                <dt className="sr-only">Origem</dt>
                <dd>Resposta do cache</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </article>
  );
}
