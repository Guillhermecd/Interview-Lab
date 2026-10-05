import type { SqlBlockMode, SqlBlockStatus } from '../../components/SqlBlock';
import type { AnswerItem } from './chat-state';

// What an answer is showing right now. Derived only from what the server sent
// (events, error codes) and from what the user did on screen.
export type MessageState =
  | 'generating'
  | 'review'
  | 'running'
  | 'streaming'
  | 'done'
  | 'empty'
  | 'blocked'
  | 'timeout'
  | 'ratelimit'
  | 'quota'
  | 'cancelled'
  | 'not_answerable'
  | 'error';

// Error codes of the API that have their own presentation.
const RATE_LIMIT_CODE = 'RATE_LIMITED';
const QUOTA_CODE = 'QUOTA_EXCEEDED';
const TIMEOUT_CODE = 'QUERY_TIMEOUT';
// The SQL was refused: by the guard, or by the read-only role of the database.
const BLOCKED_CODES: ReadonlySet<string> = new Set(['QUERY_REJECTED', 'QUERY_NOT_ALLOWED']);

export function isBlockedError(answer: AnswerItem): boolean {
  return answer.error?.code !== undefined && BLOCKED_CODES.has(answer.error.code);
}

function errorState(code: string | undefined): MessageState {
  if (code === RATE_LIMIT_CODE) {
    return 'ratelimit';
  }
  if (code === QUOTA_CODE) {
    return 'quota';
  }
  if (code === TIMEOUT_CODE) {
    return 'timeout';
  }
  return code !== undefined && BLOCKED_CODES.has(code) ? 'blocked' : 'error';
}

export function messageState(answer: AnswerItem): MessageState {
  switch (answer.status) {
    case 'error':
      return errorState(answer.error?.code);
    case 'pending_review':
      return 'review';
    case 'cancelled':
      return 'cancelled';
    case 'not_answerable':
      return 'not_answerable';
    case 'answered':
      return (answer.result?.rowCount ?? answer.rowCount) === 0 ? 'empty' : 'done';
    case 'streaming':
      if (answer.sqlAttempts.length === 0) {
        return 'generating';
      }
      return answer.result === undefined ? 'running' : 'streaming';
  }
}

export type StepStatus = 'done' | 'current' | 'error' | 'todo';

export interface MessageStep {
  label: string;
  status: StepStatus;
}

type StepKey = 'sql' | 'review' | 'execution' | 'result' | 'explanation';

const STEP_LABELS: Record<StepKey, string> = {
  sql: 'SQL',
  review: 'Revisão',
  execution: 'Execução',
  result: 'Resultado',
  explanation: 'Explicação',
};

// Where each state stands in the sequence; `failed` marks the step as an error
// and leaves the following ones undone. States without an entry show no steps.
const POSITIONS: Partial<Record<MessageState, { at: StepKey; failed?: boolean } | 'finished'>> = {
  generating: { at: 'sql' },
  review: { at: 'review' },
  cancelled: { at: 'review' },
  running: { at: 'execution' },
  streaming: { at: 'explanation' },
  done: 'finished',
  empty: 'finished',
  blocked: { at: 'sql', failed: true },
  timeout: { at: 'execution', failed: true },
};

const CURRENT_LABELS: Partial<Record<MessageState, string>> = {
  review: 'Aguardando revisão',
  cancelled: 'Cancelado',
};

// The progress indicator: SQL → Revisão → Execução → Resultado → Explicação.
// "Revisão" only exists for answers that went through review mode.
export function messageSteps(answer: AnswerItem): MessageStep[] {
  const state = messageState(answer);
  const position = POSITIONS[state];
  if (position === undefined) {
    return [];
  }
  const reviewed = answer.reviewSql !== undefined;
  const keys: StepKey[] = reviewed
    ? ['sql', 'review', 'execution', 'result', 'explanation']
    : ['sql', 'execution', 'result', 'explanation'];
  // An answer stopped outside review mode has no review step to stand on.
  const currentIndex = position === 'finished' ? keys.length : keys.indexOf(position.at);
  if (currentIndex === -1) {
    return [];
  }
  const failed = position !== 'finished' && position.failed === true;

  return keys.map((key, index) => {
    if (index < currentIndex) {
      return { label: STEP_LABELS[key], status: 'done' };
    }
    if (index > currentIndex) {
      return { label: STEP_LABELS[key], status: 'todo' };
    }
    return failed
      ? { label: STEP_LABELS[key], status: 'error' }
      : { label: CURRENT_LABELS[state] ?? STEP_LABELS[key], status: 'current' };
  });
}

export interface SqlBlockView {
  sql: string;
  mode: SqlBlockMode;
  status: SqlBlockStatus | undefined;
  edited: boolean;
}

// How the SQL of an answer is shown. `status` repeats what the server said:
// validated when the guard accepted exactly this text, blocked when it refused
// it, and nothing while this text has not been checked yet.
export function sqlBlockView(answer: AnswerItem): SqlBlockView | undefined {
  const state = messageState(answer);
  const lastSql = answer.sqlAttempts.at(-1);
  if (state === 'generating') {
    return { sql: '', mode: 'generating', status: undefined, edited: false };
  }
  if (lastSql === undefined) {
    return undefined;
  }

  const blocked = isBlockedError(answer);
  if (answer.reviewSql !== undefined && (state === 'review' || state === 'cancelled')) {
    const sql = answer.reviewDraft ?? answer.reviewSql;
    const edited = sql.trim() !== answer.reviewSql.trim();
    return {
      sql,
      mode: state === 'review' ? 'review' : 'view',
      // The generated SQL passed the guard before being offered for review.
      status: blocked ? 'blocked' : edited ? undefined : 'validated',
      edited,
    };
  }
  if (state === 'running') {
    const approved = answer.reviewSql !== undefined;
    const edited = approved && lastSql.trim() !== answer.reviewSql?.trim();
    return {
      sql: lastSql,
      mode: 'running',
      status: approved && !edited ? 'validated' : undefined,
      edited,
    };
  }

  const ran = answer.result !== undefined || answer.status === 'answered' || state === 'timeout';
  return {
    sql: lastSql,
    mode: 'view',
    status: blocked ? 'blocked' : ran ? 'validated' : undefined,
    edited: answer.edited === true,
  };
}
