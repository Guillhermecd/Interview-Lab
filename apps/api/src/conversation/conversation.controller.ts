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
  UseGuards,
} from '@nestjs/common';
import type { AuthUser, Conversation, ConversationList, MessageList } from '@interview-lab/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import { toErrorResponse } from '../http/error-response.js';
import { readAskMode, readQuestion, readSql } from '../http/request-readers.js';
import { UsageService } from '../limits/usage.service.js';
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

// Conversations of the signed-in user (Phase 08). Anything that calls the LLM
// is checked against the rate limit and the daily quota before it starts
// (rule 7).
@Controller('conversations')
@UseGuards(AuthGuard)
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(UsageService) private readonly usage: UsageService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser): Promise<Conversation> {
    return this.conversations.create(user.id);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<ConversationList> {
    return { items: await this.conversations.list(user.id) };
  }

  @Get(':id/messages')
  async listMessages(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<MessageList> {
    await this.assertOwned(id, user.id);
    return { items: await this.conversations.listMessages(id) };
  }

  // Answers as Server-Sent Events: sql → rows → token… → done, or error. With
  // `mode: "review"` the stream ends after the SQL with a `review` event.
  // Everything that can be refused with a normal HTTP error is checked before
  // the stream starts.
  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  async ask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() reply: StreamReply,
  ): Promise<void> {
    const question = readQuestion(body);
    const mode = readAskMode(body);
    await this.assertOwned(id, user.id);
    await this.usage.assertCanUseLlm(user.id);

    const completed = await this.stream(reply, (signal) =>
      this.conversations.answer(user.id, id, question, mode, signal),
    );
    if (completed) {
      await this.refreshMemory(user.id, id);
    }
  }

  // Runs the SQL of a message waiting for review, as approved or edited by the
  // user (D-33): rows → token… → done, or error. The SQL goes through the guard
  // again, exactly as if it had been generated now.
  @Post(':id/messages/:messageId/execute')
  @HttpCode(HttpStatus.OK)
  async execute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
    @Res() reply: StreamReply,
  ): Promise<void> {
    const sql = readSql(body);
    if (!MESSAGE_ID_PATTERN.test(messageId)) {
      throw new NotFoundException();
    }
    await this.assertOwned(id, user.id);
    await this.usage.assertCanUseLlm(user.id);
    const pending = await this.conversations.claimPendingReview(id, messageId);

    let completed: boolean;
    try {
      completed = await this.stream(reply, (signal) =>
        this.conversations.executeReview(user.id, id, pending, sql, signal),
      );
    } finally {
      this.conversations.releaseReview(pending.messageId);
    }
    if (completed) {
      await this.refreshMemory(user.id, id);
    }
  }

  // Writes the events as Server-Sent Events. Returns false if the client left
  // before the end; in that case `signal` was aborted, which stops the LLM call
  // and the database query that nobody will read. Once the response has
  // started, an unexpected exception can no longer become an HTTP error: it is
  // sent as an `error` event, and the response is always ended.
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
    try {
      for await (const event of produce(abort.signal)) {
        response.write(formatSseEvent(event));
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        const { body } = toErrorResponse(error, this.logger);
        response.write(formatSseEvent({ event: 'error', data: body }));
      }
    } finally {
      response.end();
    }
    return !abort.signal.aborted;
  }

  // Runs after the answer was delivered, so the client never waits for it.
  private async refreshMemory(userId: string, id: string): Promise<void> {
    try {
      await this.conversations.refreshMemory(userId, id);
    } catch (error) {
      this.logger.warn(
        `Could not refresh the conversation summary (${describeErrorForLog(error)})`,
      );
    }
  }

  // Another user's conversation answers 404, exactly like a missing one.
  private async assertOwned(id: string, userId: string): Promise<void> {
    if (!UUID_PATTERN.test(id) || !(await this.conversations.isOwnedBy(id, userId))) {
      throw new NotFoundException();
    }
  }
}
