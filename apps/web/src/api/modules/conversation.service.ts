import type {
  AnswerStreamEventName,
  AnswerStreamEvents,
  Conversation,
  ConversationList,
  ConversationMessage,
  MessageList,
} from '@interview-lab/shared';
import { ApiError, request, requestJson } from './api';
import { readServerSentEvents } from './sse';

const BASE_PATH = '/internal/conversations';

const EVENT_NAMES: readonly AnswerStreamEventName[] = ['sql', 'rows', 'token', 'done', 'error'];

export type AnswerEvent = {
  [Name in AnswerStreamEventName]: { event: Name; data: AnswerStreamEvents[Name] };
}[AnswerStreamEventName];

function isAnswerEventName(name: string): name is AnswerStreamEventName {
  return EVENT_NAMES.some((known) => known === name);
}

const STREAM_INTERRUPTED = new ApiError({
  code: 'STREAM_INTERRUPTED',
  message: 'A resposta foi interrompida antes de terminar.',
});

// Only transports data: no transformation or decision happens here.
export const ConversationService = {
  create(): Promise<Conversation> {
    return requestJson<Conversation>(BASE_PATH, { method: 'POST' });
  },

  async list(): Promise<Conversation[]> {
    return (await requestJson<ConversationList>(BASE_PATH)).items;
  },

  async messages(conversationId: string): Promise<ConversationMessage[]> {
    return (await requestJson<MessageList>(`${BASE_PATH}/${conversationId}/messages`)).items;
  },

  // Sends the question and yields the answer events as they arrive. A stream
  // that ends without `done` or `error` is reported as interrupted.
  async *ask(
    conversationId: string,
    question: string,
    signal: AbortSignal,
  ): AsyncGenerator<AnswerEvent> {
    const response = await request(`${BASE_PATH}/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ question }),
      signal,
    });
    if (response.body === null) {
      throw STREAM_INTERRUPTED;
    }

    for await (const message of readServerSentEvents(response.body)) {
      if (!isAnswerEventName(message.event)) {
        continue;
      }
      const event = { event: message.event, data: JSON.parse(message.data) as unknown };
      yield event as AnswerEvent;
      if (message.event === 'done' || message.event === 'error') {
        return;
      }
    }
    throw STREAM_INTERRUPTED;
  },
};
