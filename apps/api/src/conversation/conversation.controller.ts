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
import { readAskMode, readQuestion, readSql } from '../http/request-readers.js';
import { describeErrorForLog } from '../query/query-error.js';
import { ConversationService } from './conversation.service.js';
import { formatSseEvent, SSE_HEADERS, type AnswerStreamEvent } from './sse.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_ID_PATTERN = /^[1-9][0-9]{0,17}$/;

// The part of the Fastify reply needed to write a stream by hand.
interface StreamReply {
  // Tells Fastify that the response is written directly on `raw`.
  hijack: () => void;
  raw: ServerResponse;
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

  // Answers as Server-Sent Events: sql → rows → token… → done, or error. With
  // `mode: "review"` the stream ends after the SQL with a `review` event.
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
    const mode = readAskMode(body);
    await this.assertExists(id);

    const completed = await this.stream(reply, (signal) =>
      this.conversations.answer(id, question, mode, signal),
    );
    if (completed) {
      await this.refreshMemory(id);
    }
  }

  // Runs the SQL of a message waiting for review, as approved or edited by the
  // user (D-33): rows → token… → done, or error. The SQL goes through the guard
  // again, exactly as if it had been generated now.
  @Post(':id/messages/:messageId/execute')
  @HttpCode(HttpStatus.OK)
  async execute(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
    @Res() reply: StreamReply,
  ): Promise<void> {
    const sql = readSql(body);
    if (!UUID_PATTERN.test(id) || !MESSAGE_ID_PATTERN.test(messageId)) {
      throw new NotFoundException();
    }
    const pending = await this.conversations.getPendingReview(id, messageId);

    const completed = await this.stream(reply, (signal) =>
      this.conversations.executeReview(id, pending, sql, signal),
    );
    if (completed) {
      await this.refreshMemory(id);
    }
  }

  // Writes the events as Server-Sent Events. Returns false if the client left
  // before the end; in that case `signal` was aborted, which stops the LLM call
  // and the database query that nobody will read.
  private async stream(
    reply: StreamReply,
    produce: (signal: AbortSignal) => AsyncIterable<AnswerStreamEvent>,
  ): Promise<boolean> {
    const response = reply.raw;
    const abort = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) {
        abort.abort();
      }
    });

    reply.hijack();
    response.writeHead(HttpStatus.OK, SSE_HEADERS);
    for await (const event of produce(abort.signal)) {
      response.write(formatSseEvent(event));
    }
    response.end();
    return !abort.signal.aborted;
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
