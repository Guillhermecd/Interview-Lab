import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ApiErrorBody } from '@interview-lab/shared';
import { toErrorResponse } from './error-response.js';

// The part of the Fastify reply this filter uses.
interface HttpReply {
  status: (statusCode: number) => { send: (body: ApiErrorBody) => unknown };
}

// Every error leaves the API in the same shape ({ code, message, details? })
// and never carries a stack trace or an internal message.
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toErrorResponse(exception, this.logger);
    host.switchToHttp().getResponse<HttpReply>().status(status).send(body);
  }
}
