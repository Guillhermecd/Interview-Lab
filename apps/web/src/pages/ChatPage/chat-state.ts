import type {
  ApiErrorDetail,
  ConversationMessage,
  QueryResult,
  VisualizationSuggestion,
} from '@interview-lab/shared';
import type { AnswerEvent } from '../../api/modules/conversation.service';

// Screen state of the chat. These helpers only place what the server sent into
// the shape the screen renders; they never derive business information.

export interface QuestionItem {
  kind: 'question';
  id: string;
  text: string;
}

export type AnswerStatus = 'streaming' | 'answered' | 'not_answerable' | 'error' | 'cancelled';

export interface AnswerError {
  message: string;
  details?: ApiErrorDetail[] | undefined;
}

export interface AnswerItem {
  kind: 'answer';
  id: string;
  status: AnswerStatus;
  // One entry per attempt, in order; the last one is the SQL that ran.
  sqlAttempts: string[];
  result?: QueryResult;
  visualization?: VisualizationSuggestion;
  explanation: string;
  error?: AnswerError;
  // Loaded from the history, where result rows are not stored.
  fromHistory: boolean;
  rowCount?: number;
}

export type ChatItem = QuestionItem | AnswerItem;

export function newAnswer(id: string): AnswerItem {
  return {
    kind: 'answer',
    id,
    status: 'streaming',
    sqlAttempts: [],
    explanation: '',
    fromHistory: false,
  };
}

export function applyAnswerEvent(answer: AnswerItem, event: AnswerEvent): AnswerItem {
  switch (event.event) {
    case 'sql':
      return { ...answer, sqlAttempts: [...answer.sqlAttempts, event.data.sql] };
    case 'rows':
      return {
        ...answer,
        result: event.data.result,
        visualization: event.data.visualization,
        rowCount: event.data.result.rowCount,
      };
    case 'token':
      return { ...answer, explanation: answer.explanation + event.data.text };
    case 'done':
      return { ...answer, id: event.data.messageId, status: event.data.status };
    case 'error':
      return {
        ...answer,
        status: 'error',
        error: { message: event.data.message, details: event.data.details },
      };
  }
}

function fromAssistantMessage(message: ConversationMessage): AnswerItem {
  const item: AnswerItem = {
    kind: 'answer',
    id: message.id,
    status: message.status ?? 'answered',
    sqlAttempts: message.sql === undefined ? [] : [message.sql],
    explanation: message.status === 'error' ? '' : message.content,
    fromHistory: true,
  };
  if (message.visualization) {
    item.visualization = message.visualization;
  }
  if (message.rowCount !== undefined) {
    item.rowCount = message.rowCount;
  }
  if (message.status === 'error') {
    item.error = { message: message.content };
  }
  return item;
}

export function itemsFromMessages(messages: ConversationMessage[]): ChatItem[] {
  return messages.map((message) =>
    message.role === 'user'
      ? { kind: 'question', id: message.id, text: message.content }
      : fromAssistantMessage(message),
  );
}
