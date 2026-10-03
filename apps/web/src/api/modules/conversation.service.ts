import type {
  AnswerStreamEventName,
  AnswerStreamEvents,
  AskMode,
  AskQuestionRequest,
  Conversation,
  ConversationList,
  ConversationMessage,
  ExecuteReviewedSqlRequest,
  MessageList,
} from '@interview-lab/shared';
import { ApiError, request, requestJson } from './api';
import { readServerSentEvents } from './sse';

const BASE_PATH = '/conversations';

const EVENT_NAMES: readonly AnswerStreamEventName[] = [
  'sql',
  'rows',
  'review',
  'token',
  'done',
  'error',
];
// Events after which the server closes the stream.
const FINAL_EVENTS: readonly AnswerStreamEventName[] = ['review', 'done', 'error'];

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

// Posts the body and yields the events of the answer stream. A stream that
// ends without a final event is reported as interrupted.
async function* postForEvents(
  path: string,
  body: AskQuestionRequest | ExecuteReviewedSqlRequest,
  signal: AbortSignal,
): AsyncGenerator<AnswerEvent> {
  const response = await request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (response.body === null) {
    throw STREAM_INTERRUPTED;
  }

  for await (const message of readServerSentEvents(response.body)) {
    if (!isAnswerEventName(message.event)) {
      continue;
    }
    yield { event: message.event, data: JSON.parse(message.data) as unknown } as AnswerEvent;
    if (FINAL_EVENTS.includes(message.event)) {
      return;
    }
  }
  throw STREAM_INTERRUPTED;
}

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

  // In review mode the stream ends with a `review` event, before running.
  ask(
    conversationId: string,
    question: string,
    mode: AskMode,
    signal: AbortSignal,
  ): AsyncGenerator<AnswerEvent> {
    return postForEvents(`${BASE_PATH}/${conversationId}/messages`, { question, mode }, signal);
  },

  // Runs the SQL of a message waiting for review, as approved or edited.
  executeReview(
    conversationId: string,
    messageId: string,
    sql: string,
    signal: AbortSignal,
  ): AsyncGenerator<AnswerEvent> {
    return postForEvents(
      `${BASE_PATH}/${conversationId}/messages/${messageId}/execute`,
      { sql },
      signal,
    );
  },
};
