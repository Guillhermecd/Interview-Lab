import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorBody } from '@interview-lab/shared';
import { QueryExecutionError, type QueryErrorCode } from '../query/query-error.js';
import { ValidationError } from './validation-error.js';

const QUERY_ERROR_STATUS: Record<QueryErrorCode, HttpStatus> = {
  QUERY_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  QUERY_SYNTAX_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_INVALID_REFERENCE: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_NOT_ALLOWED: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_DATA_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  QUERY_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  DATABASE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
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

// The part of the Fastify reply this filter uses.
interface HttpReply {
  status: (statusCode: number) => { send: (body: ApiErrorBody) => unknown };
}

interface ErrorResponse {
  status: number;
  body: ApiErrorBody;
}

// Every error leaves the API in the same shape ({ code, message, details? })
// and never carries a stack trace or an internal message.
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = this.toResponse(exception);
    host.switchToHttp().getResponse<HttpReply>().status(status).send(body);
  }

  private toResponse(exception: unknown): ErrorResponse {
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

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
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

    // Unexpected failure: the stack goes to the log, never to the response.
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : undefined,
    );
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: INTERNAL_ERROR };
  }
}
