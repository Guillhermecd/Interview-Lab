import { ResultChart } from '../../components/ResultChart';
import { ResultTable } from '../../components/ResultTable';
import { SqlEditor } from '../../components/SqlEditor';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import type { AnswerItem } from './chat-state';
import { ReviewPanel } from './ReviewPanel';

interface AnswerCardProps {
  answer: AnswerItem;
  // Disables actions while another answer is streaming.
  isBusy: boolean;
  onExecuteReview: (answerId: string, messageId: string, sql: string) => void;
}

function streamingLabel(answer: AnswerItem): string {
  if (answer.sqlAttempts.length === 0) {
    return 'Gerando o SQL…';
  }
  if (answer.result === undefined) {
    return 'Executando a consulta…';
  }
  return 'Escrevendo a explicação…';
}

export function AnswerCard({ answer, isBusy, onExecuteReview }: AnswerCardProps) {
  const sql = answer.sqlAttempts.at(-1);
  const isStreaming = answer.status === 'streaming';
  const { messageId, reviewSql } = answer;
  const isReviewing =
    answer.status === 'pending_review' && reviewSql !== undefined && messageId !== undefined;

  return (
    <article
      aria-label="Resposta"
      aria-busy={isStreaming}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      {answer.explanation !== '' && (
        <p aria-live="polite" className="text-sm leading-relaxed whitespace-pre-wrap">
          {answer.explanation}
        </p>
      )}

      {isStreaming && <Spinner label={streamingLabel(answer)} />}

      {answer.status === 'cancelled' && <p className="text-sm text-muted">Resposta cancelada.</p>}

      {answer.error && (
        <ErrorMessage message={answer.error.message} details={answer.error.details} />
      )}

      {answer.sqlAttempts.length > 1 && (
        <p className="rounded-md bg-warning-surface px-2 py-1 text-xs">
          A primeira consulta foi recusada; abaixo, a segunda tentativa.
        </p>
      )}

      {isReviewing ? (
        <ReviewPanel
          sql={reviewSql}
          initialDraft={answer.reviewDraft ?? reviewSql}
          disabled={isBusy}
          onExecute={(reviewedSql) => {
            onExecuteReview(answer.id, messageId, reviewedSql);
          }}
        />
      ) : (
        sql !== undefined && (
          <section className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">SQL</h3>
              {answer.edited === true && (
                <span className="rounded-full bg-warning-surface px-2 py-0.5 text-xs">
                  Editado por você
                </span>
              )}
            </div>
            <SqlEditor value={sql} />
            {answer.edited === true && answer.generatedSql !== undefined && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Ver o SQL gerado originalmente</summary>
                <div className="mt-1">
                  <SqlEditor value={answer.generatedSql} label="SQL gerado originalmente" />
                </div>
              </details>
            )}
          </section>
        )
      )}

      {answer.result && answer.visualization && (
        <ResultChart result={answer.result} visualization={answer.visualization} />
      )}

      {answer.result && (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
            Resultado: {answer.result.rowCount} {answer.result.rowCount === 1 ? 'linha' : 'linhas'}
          </h3>
          {answer.result.truncated && (
            <p className="rounded-md bg-warning-surface px-2 py-1 text-xs">
              Mostrando as primeiras {answer.result.rowCount} linhas; a consulta tinha mais.
            </p>
          )}
          <ResultTable result={answer.result} />
        </section>
      )}

      {answer.fromHistory && answer.status === 'answered' && answer.rowCount !== undefined && (
        <p className="text-xs text-muted">
          {answer.rowCount} {answer.rowCount === 1 ? 'linha retornada' : 'linhas retornadas'}. As
          linhas não ficam salvas no histórico; faça a pergunta de novo para vê-las.
        </p>
      )}
    </article>
  );
}
