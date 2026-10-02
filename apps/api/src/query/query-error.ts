import type { ApiErrorDetail } from '@interview-lab/shared';
import { DatabaseError } from 'pg';

export const QUERY_ERROR_CODES = [
  'QUERY_TIMEOUT',
  'QUERY_SYNTAX_ERROR',
  'QUERY_INVALID_REFERENCE',
  'QUERY_NOT_ALLOWED',
  'QUERY_REJECTED',
  'QUERY_DATA_ERROR',
  'QUERY_FAILED',
  'DATABASE_UNAVAILABLE',
] as const;
export type QueryErrorCode = (typeof QUERY_ERROR_CODES)[number];

const MESSAGES: Record<QueryErrorCode, string> = {
  QUERY_TIMEOUT: 'A consulta excedeu o tempo limite de execução.',
  QUERY_SYNTAX_ERROR: 'A consulta SQL tem um erro de sintaxe.',
  QUERY_INVALID_REFERENCE: 'A consulta referencia uma tabela, coluna ou função que não existe.',
  QUERY_NOT_ALLOWED: 'A consulta tenta uma operação que não é permitida.',
  QUERY_REJECTED: 'A consulta foi recusada pelas regras de segurança.',
  QUERY_DATA_ERROR: 'A consulta falhou ao processar os dados.',
  QUERY_FAILED: 'Não foi possível executar a consulta.',
  DATABASE_UNAVAILABLE: 'O banco de dados está indisponível no momento.',
};

// https://www.postgresql.org/docs/17/errcodes-appendix.html
const SQLSTATE_QUERY_CANCELED = '57014';
const SQLSTATE_INSUFFICIENT_PRIVILEGE = '42501';
const SQLSTATE_READ_ONLY_TRANSACTION = '25006';
const SQLSTATE_SYNTAX_ERROR = '42601';
const SQLSTATE_CLASS_SYNTAX_OR_ACCESS = '42';
const SQLSTATE_CLASS_DATA_EXCEPTION = '22';
const SQLSTATE_CLASS_CONNECTION = '08';
const SQLSTATE_CLASS_INVALID_AUTHORIZATION = '28';
const SQLSTATE_CLASS_INSUFFICIENT_RESOURCES = '53';
const SQLSTATE_CLASS_OPERATOR_INTERVENTION = '57';

export class QueryExecutionError extends Error {
  constructor(
    readonly code: QueryErrorCode,
    readonly details?: ApiErrorDetail[],
  ) {
    super(MESSAGES[code]);
    this.name = 'QueryExecutionError';
  }
}

function classify(sqlState: string): QueryErrorCode {
  if (sqlState === SQLSTATE_QUERY_CANCELED) return 'QUERY_TIMEOUT';
  if (sqlState === SQLSTATE_INSUFFICIENT_PRIVILEGE) return 'QUERY_NOT_ALLOWED';
  if (sqlState === SQLSTATE_READ_ONLY_TRANSACTION) return 'QUERY_NOT_ALLOWED';
  if (sqlState === SQLSTATE_SYNTAX_ERROR) return 'QUERY_SYNTAX_ERROR';

  const sqlStateClass = sqlState.slice(0, 2);
  switch (sqlStateClass) {
    case SQLSTATE_CLASS_SYNTAX_OR_ACCESS:
      return 'QUERY_INVALID_REFERENCE';
    case SQLSTATE_CLASS_DATA_EXCEPTION:
      return 'QUERY_DATA_ERROR';
    case SQLSTATE_CLASS_CONNECTION:
    case SQLSTATE_CLASS_INVALID_AUTHORIZATION:
    case SQLSTATE_CLASS_INSUFFICIENT_RESOURCES:
    case SQLSTATE_CLASS_OPERATOR_INTERVENTION:
      return 'DATABASE_UNAVAILABLE';
    default:
      return 'QUERY_FAILED';
  }
}

// Only syntax and name-resolution messages are passed on: they describe the
// query text itself and let the author (or the LLM) fix it. Every other
// PostgreSQL message may echo row values or internal details and is dropped.
function safeDetails(code: QueryErrorCode, error: DatabaseError): ApiErrorDetail[] | undefined {
  if (code !== 'QUERY_SYNTAX_ERROR' && code !== 'QUERY_INVALID_REFERENCE') {
    return undefined;
  }
  return [{ field: 'sql', message: error.message }];
}

export function translateDatabaseError(error: unknown): QueryExecutionError {
  if (error instanceof QueryExecutionError) {
    return error;
  }
  if (error instanceof DatabaseError && error.code !== undefined) {
    const code = classify(error.code);
    return new QueryExecutionError(code, safeDetails(code, error));
  }
  // Anything that is not a PostgreSQL error response is a driver or network
  // failure (refused connection, reset socket, pool timeout).
  return new QueryExecutionError('DATABASE_UNAVAILABLE');
}

// For logs: the SQLSTATE or the Node error code identifies the failure without
// exposing the SQL text, row values or credentials.
export function describeErrorForLog(error: unknown): string {
  if (error instanceof DatabaseError) {
    return `sqlstate=${error.code ?? 'unknown'}`;
  }
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return `code=${error.code}`;
  }
  return error instanceof Error ? `name=${error.name}` : 'unknown error';
}
