import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  AskMode,
  AskResponse,
  Conversation,
  ConversationMessage,
  UnansweredQuestion,
} from '@interview-lab/shared';
import { AskService, type AskEvent, type SqlForReview } from '../ask/ask.service.js';
import { parseSummary } from '../ask/llm-output.js';
import { buildSummaryRequest } from '../ask/prompts.js';
import { toErrorResponse } from '../http/error-response.js';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm-provider.js';
import { describeErrorForLog } from '../query/query-error.js';
import { selectMessagesToSummarize, toConversationContext } from './conversation-memory.js';
import {
  ConversationRepository,
  type AssistantMessageInput,
  type PendingReview,
} from './conversation.repository.js';
import type { AnswerStreamEvent } from './sse.js';

type Answer = AskResponse | SqlForReview;

function toAssistantMessage(answer: Answer): AssistantMessageInput {
  switch (answer.status) {
    case 'not_answerable':
      return { content: answer.reason, status: 'not_answerable', usage: answer.usage };
    case 'pending_review':
      return {
        content: '',
        status: 'pending_review',
        sql: answer.sql,
        visualization: answer.proposedVisualization,
        attempts: answer.attempts,
        usage: answer.usage,
      };
    case 'answered':
      return {
        content: answer.explanation,
        status: 'answered',
        sql: answer.sql,
        visualization: answer.visualization,
        rowCount: answer.result.rowCount,
        attempts: answer.attempts,
        usage: answer.usage,
      };
  }
}

function lastEvent(answer: Answer, messageId: string): AnswerStreamEvent {
  if (answer.status === 'pending_review') {
    return { event: 'review', data: { messageId, sql: answer.sql } };
  }
  return {
    event: 'done',
    data: {
      messageId,
      status: answer.status,
      attempts: answer.status === 'answered' ? answer.attempts : 0,
      usage: answer.usage,
    },
  };
}

function toStreamEvent(step: AskEvent): AnswerStreamEvent {
  switch (step.type) {
    case 'sql':
      return { event: 'sql', data: { sql: step.sql, attempt: step.attempt } };
    case 'rows':
      return { event: 'rows', data: { result: step.result, visualization: step.visualization } };
    case 'token':
      return { event: 'token', data: { text: step.text } };
  }
}

// Forwards the events of an AskService generator and returns its final value.
async function* forward<T>(
  steps: AsyncGenerator<AskEvent, T>,
): AsyncGenerator<AnswerStreamEvent, T> {
  let step = await steps.next();
  while (step.done !== true) {
    yield toStreamEvent(step.value);
    step = await steps.next();
  }
  return step.value;
}

// A conversation: stores the messages, gives the LLM the memory of what came
// before and turns the answer into a stream of events.
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  // Reviews being executed right now, so the same one cannot run twice at once.
  private readonly executing = new Set<string>();

  constructor(
    @Inject(ConversationRepository) private readonly repository: ConversationRepository,
    @Inject(AskService)
    private readonly askService: Pick<
      AskService,
      'stream' | 'streamReview' | 'streamReviewedExecution'
    >,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
  ) {}

  create(): Promise<Conversation> {
    return this.repository.create();
  }

  list(): Promise<Conversation[]> {
    return this.repository.list();
  }

  exists(conversationId: string): Promise<boolean> {
    return this.repository.exists(conversationId);
  }

  listMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.repository.listMessages(conversationId);
  }

  // Answers a question inside a conversation. In review mode the stream stops
  // after the SQL, with a `review` event. Failures become an `error` event
  // instead of an exception, because by then the HTTP response has started.
  // If `signal` is aborted (the client left), the stream just ends.
  async *answer(
    conversationId: string,
    question: string,
    mode: AskMode,
    signal: AbortSignal,
  ): AsyncGenerator<AnswerStreamEvent> {
    try {
      const memory = await this.repository.loadMemory(conversationId);
      await this.repository.addUserMessage(conversationId, question);

      const input = { question, context: toConversationContext(memory) };
      const answer: Answer =
        mode === 'review'
          ? yield* forward<SqlForReview | UnansweredQuestion>(
              this.askService.streamReview(input, signal),
            )
          : yield* forward<AskResponse>(this.askService.stream(input, signal));

      const message = await this.repository.addAssistantMessage(
        conversationId,
        toAssistantMessage(answer),
      );
      yield lastEvent(answer, message.id);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      const { body } = toErrorResponse(error, this.logger);
      await this.saveFailure(conversationId, body.message);
      yield { event: 'error', data: body };
    }
  }

  // Reserves a pending review for one execution. Done before the execution
  // stream starts, so these cases get a normal HTTP error: 404 if there is no
  // such message waiting for review, 409 if it is already being executed. The
  // caller must call releaseReview() once the execution ends, whatever happens.
  async claimPendingReview(conversationId: string, messageId: string): Promise<PendingReview> {
    const pending = await this.repository.findPendingReview(conversationId, messageId);
    if (pending === undefined) {
      throw new NotFoundException();
    }
    // Checked and reserved with no await in between, so two requests cannot
    // both get through.
    if (this.executing.has(pending.messageId)) {
      throw new ConflictException();
    }
    this.executing.add(pending.messageId);
    return pending;
  }

  releaseReview(messageId: string): void {
    this.executing.delete(messageId);
  }

  // Runs the SQL the user approved or edited for a review reserved with
  // claimPendingReview() (D-33). The SQL goes through the guard again. If it is
  // refused or anything fails, the message stays pending, so the user can fix
  // the SQL and try again.
  async *executeReview(
    conversationId: string,
    pending: PendingReview,
    sql: string,
    signal: AbortSignal,
  ): AsyncGenerator<AnswerStreamEvent> {
    try {
      const answer = yield* forward(
        this.askService.streamReviewedExecution(
          {
            question: pending.question,
            sql,
            proposedVisualization: pending.proposedVisualization,
          },
          signal,
        ),
      );
      const edited = sql.trim() !== pending.generatedSql.trim();
      const completed = await this.repository.completeReview(conversationId, pending.messageId, {
        content: answer.explanation,
        executedSql: sql,
        edited,
        visualization: answer.visualization,
        rowCount: answer.result.rowCount,
        usage: answer.usage,
      });
      if (!completed) {
        throw new ConflictException();
      }
      yield {
        event: 'done',
        data: {
          messageId: pending.messageId,
          status: 'answered',
          attempts: answer.attempts,
          usage: answer.usage,
          edited,
        },
      };
    } catch (error) {
      if (!signal.aborted) {
        yield { event: 'error', data: toErrorResponse(error, this.logger).body };
      }
    }
  }

  // Applies the memory rule (D-27). Returns true when a new summary was stored.
  // Meant to run after an answer has been delivered; a failure here only delays
  // the summary until the next answer.
  async refreshMemory(conversationId: string): Promise<boolean> {
    const memory = await this.repository.loadMemory(conversationId);
    const toSummarize = selectMessagesToSummarize(memory.unsummarized);
    const last = toSummarize.at(-1);
    if (last === undefined) {
      return false;
    }

    const response = await this.provider.generateJson(
      buildSummaryRequest({
        ...(memory.summary !== undefined && { previousSummary: memory.summary }),
        messages: toSummarize,
      }),
    );
    await this.repository.saveSummary(conversationId, parseSummary(response.data), last.id);
    return true;
  }

  private async saveFailure(conversationId: string, message: string): Promise<void> {
    try {
      await this.repository.addAssistantMessage(conversationId, {
        content: message,
        status: 'error',
      });
    } catch (error) {
      // The client still gets the original error; only the history misses it.
      this.logger.error(`Could not store a failed answer (${describeErrorForLog(error)})`);
    }
  }
}
