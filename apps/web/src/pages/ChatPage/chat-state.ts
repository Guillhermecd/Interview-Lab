import type {
  ApiErrorDetail,
  ConversationMessage,
  QueryResult,
  TokenUsage,
  VisualizationSuggestion,
} from '@interview-lab/shared';
import type { AnswerEvent } from '../../api/modules/conversation.service';

// Screen state of the chat. These helpers only place what the server sent into
// the shape the screen renders; they never derive business information.

export interface QuestionItem {
  kind: 'question';
  id: string;
  text: string;
  // When it was asked (ISO 8601).
  time: string;
}

export type AnswerStatus =
  'streaming' | 'pending_review' | 'answered' | 'not_answerable' | 'error' | 'cancelled';

export interface AnswerError {
  // Absent on errors loaded from the history, which stores only the message.
  code?: string | undefined;
  message: string;
  details?: ApiErrorDetail[] | undefined;
  // Sent with usage limits: seconds until the limit resets.
  retryAfterSeconds?: number | undefined;
}

export interface AnswerItem {
  kind: 'answer';
  // Stable for the lifetime of the item on screen.
  id: string;
  // Id of the stored message: known at the end of the answer, or when the SQL
  // is ready for review.
  messageId?: string;
  status: AnswerStatus;
  // When the answer started (ISO 8601).
  time: string;
  // One entry per attempt, in order; the last one is the SQL that ran (or that
  // waits for review).
  sqlAttempts: string[];
  result?: QueryResult;
  visualization?: VisualizationSuggestion;
  explanation: string;
  error?: AnswerError;
  // Loaded from the history, where result rows are not stored.
  fromHistory: boolean;
  rowCount?: number;
  // Review mode: the SQL generated for approval, and the last version the user
  // sent (kept so a refused edit can be fixed instead of retyped).
  reviewSql?: string;
  reviewDraft?: string;
  // True while a reviewed SQL is running: a failure brings the review back.
  executingReview?: boolean;
  // Set by the server when a reviewed SQL ran (audit of the user's edit).
  edited?: boolean;
  generatedSql?: string;
  // Sent by the server when the answer ends.
  usage?: TokenUsage;
  cached?: boolean;
}

export type ChatItem = QuestionItem | AnswerItem;

export function newAnswer(id: string, time: string): AnswerItem {
  return {
    kind: 'answer',
    id,
    status: 'streaming',
    time,
    sqlAttempts: [],
    explanation: '',
    fromHistory: false,
  };
}

// The user sent the reviewed SQL: the answer streams again from the rows on.
export function startReviewExecution(answer: AnswerItem, sql: string): AnswerItem {
  return {
    ...answer,
    error: undefined,
    status: 'streaming',
    executingReview: true,
    reviewDraft: sql,
    sqlAttempts: [...answer.sqlAttempts.slice(0, -1), sql],
    explanation: '',
  };
}

// The user changed the SQL waiting for review, or (without `sql`) went back to
// the generated one. What the server said about the previous text is dropped.
export function editReviewDraft(answer: AnswerItem, sql: string | undefined): AnswerItem {
  return { ...answer, error: undefined, reviewDraft: sql };
}

// The user gave up running the SQL under review. Nothing is sent to the
// server: the message stays pending there and can be reviewed again.
export function cancelReview(answer: AnswerItem): AnswerItem {
  return answer.status === 'pending_review' ? { ...answer, status: 'cancelled' } : answer;
}

export function reopenReview(answer: AnswerItem): AnswerItem {
  const canReview = answer.reviewSql !== undefined && answer.messageId !== undefined;
  return answer.status === 'cancelled' && canReview
    ? { ...answer, status: 'pending_review' }
    : answer;
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
    case 'review':
      return {
        ...answer,
        messageId: event.data.messageId,
        status: 'pending_review',
        reviewSql: event.data.sql,
        // The review event carries the SQL to approve; it is the last attempt.
        sqlAttempts:
          answer.sqlAttempts.at(-1) === event.data.sql
            ? answer.sqlAttempts
            : [...answer.sqlAttempts, event.data.sql],
      };
    case 'token':
      return { ...answer, explanation: answer.explanation + event.data.text };
    case 'done':
      return {
        ...answer,
        messageId: event.data.messageId,
        status: event.data.status,
        executingReview: false,
        usage: event.data.usage,
        ...(event.data.cached !== undefined && { cached: event.data.cached }),
        ...(event.data.edited !== undefined && { edited: event.data.edited }),
        ...(event.data.edited === true &&
          answer.reviewSql !== undefined && { generatedSql: answer.reviewSql }),
      };
    case 'error':
      return {
        ...answer,
        // A refused review goes back to the user, who can fix the SQL.
        status: answer.executingReview === true ? 'pending_review' : 'error',
        executingReview: false,
        error: {
          code: event.data.code,
          message: event.data.message,
          details: event.data.details,
          retryAfterSeconds: event.data.retryAfterSeconds,
        },
      };
  }
}

function fromAssistantMessage(message: ConversationMessage): AnswerItem {
  const item: AnswerItem = {
    kind: 'answer',
    id: message.id,
    messageId: message.id,
    status: message.status ?? 'answered',
    time: message.createdAt,
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
  if (message.edited !== undefined) {
    item.edited = message.edited;
  }
  if (message.generatedSql !== undefined) {
    item.generatedSql = message.generatedSql;
  }
  if (message.status === 'pending_review' && message.sql !== undefined) {
    item.reviewSql = message.sql;
  }
  return item;
}

export function itemsFromMessages(messages: ConversationMessage[]): ChatItem[] {
  return messages.map((message) =>
    message.role === 'user'
      ? { kind: 'question', id: message.id, text: message.content, time: message.createdAt }
      : fromAssistantMessage(message),
  );
}
