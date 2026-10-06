import { Inject, Injectable } from '@nestjs/common';
import type {
  AssistantMessageStatus,
  Conversation,
  ConversationAttention,
  ConversationMessage,
  MessageRole,
  TokenUsage,
  VisualizationSuggestion,
} from '@interview-lab/shared';
import type { Pool } from 'pg';
import type { ProposedVisualization } from '../ask/llm-output.js';
import { APP_POOL } from './app-pool.js';
import type { ConversationMemory } from './conversation-memory.js';

const MAX_TITLE_LENGTH = 80;
const MAX_LISTED_CONVERSATIONS = 50;

export interface AssistantMessageInput {
  content: string;
  status: AssistantMessageStatus;
  sql?: string;
  // A validated suggestion for answered messages; the LLM's raw proposal for
  // messages waiting for review.
  visualization?: VisualizationSuggestion | ProposedVisualization;
  rowCount?: number;
  attempts?: number;
  usage?: TokenUsage;
  // The stable code of the failure, for messages with status "error".
  errorCode?: string;
}

export interface ReviewedAnswerInput {
  content: string;
  executedSql: string;
  edited: boolean;
  visualization: VisualizationSuggestion;
  rowCount: number;
  usage: TokenUsage;
}

// A message generated in review mode, with what is needed to run it.
export interface PendingReview {
  messageId: string;
  question: string;
  generatedSql: string;
  proposedVisualization: ProposedVisualization;
}

interface ConversationRow {
  id: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
  // Of the last assistant message; absent when the row comes from an INSERT.
  last_status?: AssistantMessageStatus | null;
  last_error_code?: string | null;
}

// Failures of the last answer that the list points out (D-41).
const BLOCKED_CODES: ReadonlySet<string> = new Set(['QUERY_REJECTED', 'QUERY_NOT_ALLOWED']);
const TIMEOUT_CODE = 'QUERY_TIMEOUT';

// Whether the last answer of the conversation needs the user's attention.
function attentionOf(row: ConversationRow): ConversationAttention | undefined {
  if (row.last_status === 'pending_review') {
    return 'pending_review';
  }
  if (row.last_status !== 'error' || row.last_error_code == null) {
    return undefined;
  }
  if (BLOCKED_CODES.has(row.last_error_code)) {
    return 'blocked';
  }
  return row.last_error_code === TIMEOUT_CODE ? 'timeout' : undefined;
}

interface MessageRow {
  id: string;
  role: MessageRole;
  content: string;
  status: AssistantMessageStatus | null;
  sql: string | null;
  visualization: VisualizationSuggestion | null;
  row_count: number | null;
  generated_sql: string | null;
  edited: boolean | null;
  created_at: Date;
}

interface MemoryRow {
  summary: string | null;
  summarized_through_message_id: string | null;
}

interface PendingRow {
  id: string;
  sql: string;
  visualization: Partial<ProposedVisualization> | null;
  question: string | null;
}

const CONVERSATION_COLUMNS = 'id, title, created_at, updated_at';
const MESSAGE_COLUMNS =
  'id, role, content, status, sql, visualization, row_count, generated_sql, edited, created_at';

function toConversation(row: ConversationRow): Conversation {
  const attention = attentionOf(row);
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(attention !== undefined && { attention }),
  };
}

function toMessage(row: MessageRow): ConversationMessage {
  // Only answered messages carry a validated chart suggestion.
  const visualization = row.status === 'answered' ? row.visualization : null;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    ...(row.status !== null && { status: row.status }),
    ...(row.sql !== null && { sql: row.sql }),
    ...(visualization !== null && { visualization }),
    ...(row.row_count !== null && { rowCount: row.row_count }),
    ...(row.edited !== null && { edited: row.edited }),
    ...(row.edited === true && row.generated_sql !== null && { generatedSql: row.generated_sql }),
    createdAt: row.created_at.toISOString(),
  };
}

// Persistence of conversations and messages (schema `app`, role app_rw).
// Every statement is fixed text with bind parameters.
@Injectable()
export class ConversationRepository {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async create(ownerId: string): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      `INSERT INTO app.conversations (owner_id) VALUES ($1) RETURNING ${CONVERSATION_COLUMNS}`,
      [ownerId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('INSERT INTO app.conversations returned no row');
    }
    return toConversation(row);
  }

  async list(ownerId: string): Promise<Conversation[]> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              last.status AS last_status, last.error_code AS last_error_code
       FROM app.conversations c
       LEFT JOIN LATERAL (
         SELECT m.status, m.error_code FROM app.messages m
         WHERE m.conversation_id = c.id AND m.role = 'assistant'
         ORDER BY m.id DESC LIMIT 1
       ) last ON true
       WHERE c.owner_id = $1 ORDER BY c.updated_at DESC LIMIT $2`,
      [ownerId, MAX_LISTED_CONVERSATIONS],
    );
    return result.rows.map(toConversation);
  }

  // Conversations of other users, and those created before authentication
  // (no owner, D-35), do not exist for this user.
  async isOwnedBy(conversationId: string, ownerId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM app.conversations WHERE id = $1 AND owner_id = $2',
      [conversationId, ownerId],
    );
    return result.rowCount === 1;
  }

  async listMessages(conversationId: string): Promise<ConversationMessage[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM app.messages WHERE conversation_id = $1 ORDER BY id`,
      [conversationId],
    );
    return result.rows.map(toMessage);
  }

  // The first question becomes the title of the conversation.
  async addUserMessage(conversationId: string, content: string): Promise<ConversationMessage> {
    const message = await this.insertMessage(conversationId, 'user', { content });
    await this.pool.query(
      `UPDATE app.conversations
       SET title = coalesce(title, $2), updated_at = now() WHERE id = $1`,
      [conversationId, content.slice(0, MAX_TITLE_LENGTH)],
    );
    return message;
  }

  async addAssistantMessage(
    conversationId: string,
    input: AssistantMessageInput,
  ): Promise<ConversationMessage> {
    const message = await this.insertMessage(conversationId, 'assistant', input);
    await this.touch(conversationId);
    return message;
  }

  // A message of this conversation that is waiting for review, with the
  // question it answers; undefined if there is none with this id.
  async findPendingReview(
    conversationId: string,
    messageId: string,
  ): Promise<PendingReview | undefined> {
    const result = await this.pool.query<PendingRow>(
      `SELECT m.id, m.sql, m.visualization,
              (SELECT q.content FROM app.messages q
               WHERE q.conversation_id = m.conversation_id AND q.role = 'user' AND q.id < m.id
               ORDER BY q.id DESC LIMIT 1) AS question
       FROM app.messages m
       WHERE m.conversation_id = $1 AND m.id = $2 AND m.status = 'pending_review'`,
      [conversationId, messageId],
    );
    const row = result.rows[0];
    if (row === undefined || row.question === null) {
      return undefined;
    }
    return {
      messageId: row.id,
      question: row.question,
      generatedSql: row.sql,
      proposedVisualization: {
        type: row.visualization?.type ?? '',
        xColumn: row.visualization?.xColumn ?? '',
        yColumn: row.visualization?.yColumn ?? '',
      },
    };
  }

  // Turns a pending message into an answered one. Only succeeds while it is
  // still pending, so the same review cannot be completed twice.
  async completeReview(
    conversationId: string,
    messageId: string,
    input: ReviewedAnswerInput,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE app.messages
       SET status = 'answered', content = $3, generated_sql = sql, sql = $4, edited = $5,
           visualization = $6, row_count = $7,
           input_tokens = coalesce(input_tokens, 0) + $8,
           output_tokens = coalesce(output_tokens, 0) + $9
       WHERE conversation_id = $1 AND id = $2 AND status = 'pending_review'`,
      [
        conversationId,
        messageId,
        input.content,
        input.executedSql,
        input.edited,
        JSON.stringify(input.visualization),
        input.rowCount,
        input.usage.inputTokens,
        input.usage.outputTokens,
      ],
    );
    await this.touch(conversationId);
    return result.rowCount === 1;
  }

  async loadMemory(conversationId: string): Promise<ConversationMemory> {
    const conversation = await this.pool.query<MemoryRow>(
      'SELECT summary, summarized_through_message_id FROM app.conversations WHERE id = $1',
      [conversationId],
    );
    const state = conversation.rows[0];
    const messages = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM app.messages
       WHERE conversation_id = $1 AND id > $2 ORDER BY id`,
      [conversationId, state?.summarized_through_message_id ?? 0],
    );

    return {
      summary: state?.summary ?? undefined,
      unsummarized: messages.rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        ...(row.sql !== null && { sql: row.sql }),
      })),
    };
  }

  async saveSummary(
    conversationId: string,
    summary: string,
    throughMessageId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE app.conversations
       SET summary = $2, summarized_through_message_id = $3 WHERE id = $1`,
      [conversationId, summary, throughMessageId],
    );
  }

  private async touch(conversationId: string): Promise<void> {
    await this.pool.query('UPDATE app.conversations SET updated_at = now() WHERE id = $1', [
      conversationId,
    ]);
  }

  private async insertMessage(
    conversationId: string,
    role: MessageRole,
    input: Partial<AssistantMessageInput> & { content: string },
  ): Promise<ConversationMessage> {
    const result = await this.pool.query<MessageRow>(
      `INSERT INTO app.messages
         (conversation_id, role, content, status, sql, visualization, row_count, attempts,
          input_tokens, output_tokens, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${MESSAGE_COLUMNS}`,
      [
        conversationId,
        role,
        input.content,
        input.status ?? null,
        input.sql ?? null,
        input.visualization ? JSON.stringify(input.visualization) : null,
        input.rowCount ?? null,
        input.attempts ?? null,
        input.usage?.inputTokens ?? null,
        input.usage?.outputTokens ?? null,
        input.errorCode ?? null,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('INSERT INTO app.messages returned no row');
    }
    return toMessage(row);
  }
}
