import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AskResponse, Conversation, ConversationMessage } from '@interview-lab/shared';
import { AskService, type AskEvent } from '../ask/ask.service.js';
import { parseSummary } from '../ask/llm-output.js';
import { buildSummaryRequest } from '../ask/prompts.js';
import { toErrorResponse } from '../http/error-response.js';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm-provider.js';
import { describeErrorForLog } from '../query/query-error.js';
import { selectMessagesToSummarize, toConversationContext } from './conversation-memory.js';
import { ConversationRepository, type AssistantMessageInput } from './conversation.repository.js';
import type { AnswerStreamEvent } from './sse.js';

function toAssistantMessage(answer: AskResponse): AssistantMessageInput {
  if (answer.status === 'not_answerable') {
    return { content: answer.reason, status: 'not_answerable', usage: answer.usage };
  }
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

// A conversation: stores the messages, gives the LLM the memory of what came
// before and turns the answer into a stream of events.
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Inject(ConversationRepository) private readonly repository: ConversationRepository,
    @Inject(AskService) private readonly askService: Pick<AskService, 'stream'>,
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

  // Answers a question inside a conversation. Failures become an `error` event
  // instead of an exception, because by then the HTTP response has started.
  // If `signal` is aborted (the client left), the stream just ends.
  async *answer(
    conversationId: string,
    question: string,
    signal: AbortSignal,
  ): AsyncGenerator<AnswerStreamEvent> {
    try {
      const memory = await this.repository.loadMemory(conversationId);
      await this.repository.addUserMessage(conversationId, question);

      const steps = this.askService.stream(
        { question, context: toConversationContext(memory) },
        signal,
      );
      let step = await steps.next();
      while (step.done !== true) {
        yield this.toStreamEvent(step.value);
        step = await steps.next();
      }

      const answer = step.value;
      const message = await this.repository.addAssistantMessage(
        conversationId,
        toAssistantMessage(answer),
      );
      yield {
        event: 'done',
        data: {
          messageId: message.id,
          status: answer.status,
          attempts: answer.status === 'answered' ? answer.attempts : 0,
          usage: answer.usage,
        },
      };
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      const { body } = toErrorResponse(error, this.logger);
      await this.saveFailure(conversationId, body.message);
      yield { event: 'error', data: body };
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

  private toStreamEvent(step: AskEvent): AnswerStreamEvent {
    switch (step.type) {
      case 'sql':
        return { event: 'sql', data: { sql: step.sql, attempt: step.attempt } };
      case 'rows':
        return {
          event: 'rows',
          data: { result: step.result, visualization: step.visualization },
        };
      case 'token':
        return { event: 'token', data: { text: step.text } };
    }
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
