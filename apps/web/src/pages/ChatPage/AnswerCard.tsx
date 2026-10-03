import { ResultChart } from '../../components/ResultChart';
import { ResultTable } from '../../components/ResultTable';
import { SqlViewer } from '../../components/SqlViewer';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import type { AnswerItem } from './chat-state';

interface AnswerCardProps {
  answer: AnswerItem;
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

export function AnswerCard({ answer }: AnswerCardProps) {
  const sql = answer.sqlAttempts.at(-1);
  const isStreaming = answer.status === 'streaming';

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

      {sql !== undefined && (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">SQL</h3>
          {answer.sqlAttempts.length > 1 && (
            <p className="rounded-md bg-warning-surface px-2 py-1 text-xs">
              A primeira consulta foi recusada; esta é a versão corrigida.
            </p>
          )}
          <SqlViewer sql={sql} />
        </section>
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

      {answer.fromHistory && answer.rowCount !== undefined && (
        <p className="text-xs text-muted">
          {answer.rowCount} {answer.rowCount === 1 ? 'linha retornada' : 'linhas retornadas'}. As
          linhas não ficam salvas no histórico; faça a pergunta de novo para vê-las.
        </p>
      )}
    </article>
  );
}
