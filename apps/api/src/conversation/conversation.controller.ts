import type { ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Conversation, ConversationList, MessageList } from '@interview-lab/shared';
import { ValidationError } from '../http/validation-error.js';
import { describeErrorForLog } from '../query/query-error.js';
import { ConversationService } from './conversation.service.js';
import { formatSseEvent, SSE_HEADERS } from './sse.js';

const MAX_QUESTION_LENGTH = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The part of the Fastify reply needed to write a stream by hand.
interface StreamReply {
  // Tells Fastify that the response is written directly on `raw`.
  hijack: () => void;
  raw: ServerResponse;
}

function readQuestion(body: unknown): string {
  const question =
    typeof body === 'object' && body !== null && 'question' in body ? body.question : undefined;

  if (typeof question !== 'string' || question.trim() === '') {
    throw new ValidationError([{ field: 'question', message: 'Informe a pergunta.' }]);
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new ValidationError([
      {
        field: 'question',
        message: `A pergunta pode ter no máximo ${String(MAX_QUESTION_LENGTH)} caracteres.`,
      },
    ]);
  }
  return question.trim();
}

// Internal endpoints: no authentication, rate limit or owner yet (Phase 08).
// Registered only when INTERNAL_QUERY_ENDPOINT_ENABLED=true (D-22, D-28).
@Controller('internal/conversations')
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(@Inject(ConversationService) private readonly conversations: ConversationService) {}

  @Post()
  create(): Promise<Conversation> {
    return this.conversations.create();
  }

  @Get()
  async list(): Promise<ConversationList> {
    return { items: await this.conversations.list() };
  }

  @Get(':id/messages')
  async listMessages(@Param('id') id: string): Promise<MessageList> {
    await this.assertExists(id);
    return { items: await this.conversations.listMessages(id) };
  }

  // Answers as Server-Sent Events: sql → rows → token… → done, or error.
  // Everything that can be refused with a normal HTTP error is checked before
  // the stream starts.
  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  async ask(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() reply: StreamReply,
  ): Promise<void> {
    const question = readQuestion(body);
    await this.assertExists(id);

    const response = reply.raw;
    const abort = new AbortController();
    // "close" before the response has ended means the client went away: stop
    // the LLM call and the database query, which nobody will read.
    response.on('close', () => {
      if (!response.writableEnded) {
        abort.abort();
      }
    });

    reply.hijack();
    response.writeHead(HttpStatus.OK, SSE_HEADERS);
    for await (const event of this.conversations.answer(id, question, abort.signal)) {
      response.write(formatSseEvent(event));
    }
    response.end();

    if (!abort.signal.aborted) {
      await this.refreshMemory(id);
    }
  }

  // Runs after the answer was delivered, so the client never waits for it.
  private async refreshMemory(id: string): Promise<void> {
    try {
      await this.conversations.refreshMemory(id);
    } catch (error) {
      this.logger.warn(
        `Could not refresh the conversation summary (${describeErrorForLog(error)})`,
      );
    }
  }

  private async assertExists(id: string): Promise<void> {
    if (!UUID_PATTERN.test(id) || !(await this.conversations.exists(id))) {
      throw new NotFoundException();
    }
  }
}
