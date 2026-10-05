import { HttpException, HttpStatus, type Logger } from '@nestjs/common';
import type { ApiErrorBody } from '@interview-lab/shared';
import { LimitError } from '../limits/limit-error.js';
import { LlmError, type LlmErrorCode } from '../llm/llm-error.js';
import { QueryExecutionError, type QueryErrorCode } from '../query/query-error.js';
import { ValidationError } from './validation-error.js';

const QUERY_ERROR_STATUS: Record<QueryErrorCode, HttpStatus> = {
  QUERY_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  // The client gave up; it will normally never read this status.
  QUERY_CANCELLED: HttpStatus.REQUEST_TIMEOUT,
  QUERY_SYNTAX_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_INVALID_REFERENCE: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_NOT_ALLOWED: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_REJECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_DATA_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  DATABASE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
};

const LLM_ERROR_STATUS: Record<LlmErrorCode, HttpStatus> = {
  LLM_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  LLM_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  LLM_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  LLM_INVALID_RESPONSE: HttpStatus.BAD_GATEWAY,
  LLM_CANCELLED: HttpStatus.REQUEST_TIMEOUT,
};

const HTTP_ERRORS = new Map<number, ApiErrorBody>([
  [HttpStatus.BAD_REQUEST, { code: 'VALIDATION_ERROR', message: 'A requisição é inválida.' }],
  [HttpStatus.UNAUTHORIZED, { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' }],
  [HttpStatus.FORBIDDEN, { code: 'FORBIDDEN', message: 'Acesso negado.' }],
  [HttpStatus.NOT_FOUND, { code: 'NOT_FOUND', message: 'Recurso não encontrado.' }],
  [HttpStatus.CONFLICT, { code: 'CONFLICT', message: 'Conflito com o estado atual.' }],
  [
    HttpStatus.SERVICE_UNAVAILABLE,
    { code: 'SERVICE_UNAVAILABLE', message: 'Serviço indisponível no momento.' },
  ],
]);

const FIRST_SERVER_ERROR_STATUS = 500;

const INTERNAL_ERROR: ApiErrorBody = {
  code: 'INTERNAL_ERROR',
  message: 'Ocorreu um erro interno.',
};

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  );
}

export interface ErrorResponse {
  status: number;
  body: ApiErrorBody;
}

// Turns any failure into the standard error body ({ code, message, details? }).
// Used for plain HTTP responses and for the `error` event of a stream, so both
// say the same thing. An unexpected failure is logged with its stack and
// reported as a generic internal error: nothing internal reaches the client.
export function toErrorResponse(exception: unknown, logger: Logger): ErrorResponse {
  if (exception instanceof ValidationError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: { code: 'VALIDATION_ERROR', message: exception.message, details: exception.details },
    };
  }

  if (exception instanceof QueryExecutionError) {
    return {
      status: QUERY_ERROR_STATUS[exception.code],
      body: {
        code: exception.code,
        message: exception.message,
        ...(exception.details && { details: exception.details }),
      },
    };
  }

  if (exception instanceof LlmError) {
    return {
      status: LLM_ERROR_STATUS[exception.code],
      body: { code: exception.code, message: exception.message },
    };
  }

  if (exception instanceof LimitError) {
    return {
      status: HttpStatus.TOO_MANY_REQUESTS,
      body: {
        code: exception.code,
        message: exception.message,
        retryAfterSeconds: exception.retryAfterSeconds,
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    // Errors raised with their own code and message (e.g. INVALID_CREDENTIALS).
    const own = exception.getResponse();
    if (isErrorBody(own)) {
      return { status, body: { code: own.code, message: own.message } };
    }
    const body = HTTP_ERRORS.get(status);
    if (body) {
      return { status, body };
    }
    if (status < FIRST_SERVER_ERROR_STATUS) {
      return {
        status,
        body: { code: 'REQUEST_ERROR', message: 'A requisição não pôde ser atendida.' },
      };
    }
  }

  logger.error('Unhandled exception', exception instanceof Error ? exception.stack : undefined);
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: INTERNAL_ERROR };
}
