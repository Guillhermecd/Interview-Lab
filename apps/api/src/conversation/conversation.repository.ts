import { Inject, Injectable } from '@nestjs/common';
import type {
  AssistantMessageStatus,
  Conversation,
  ConversationMessage,
  MessageRole,
  TokenUsage,
  VisualizationSuggestion,
} from '@interview-lab/shared';
import type { Pool } from 'pg';
import { APP_POOL } from './app-pool.js';
import type { ConversationMemory } from './conversation-memory.js';

const MAX_TITLE_LENGTH = 80;
const MAX_LISTED_CONVERSATIONS = 50;

export interface AssistantMessageInput {
  content: string;
  status: AssistantMessageStatus;
  sql?: string;
  visualization?: VisualizationSuggestion;
  rowCount?: number;
  attempts?: number;
  usage?: TokenUsage;
}

interface ConversationRow {
  id: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  role: MessageRole;
  content: string;
  status: AssistantMessageStatus | null;
  sql: string | null;
  visualization: VisualizationSuggestion | null;
  row_count: number | null;
  created_at: Date;
}

interface MemoryRow {
  summary: string | null;
  summarized_through_message_id: string | null;
}

const CONVERSATION_COLUMNS = 'id, title, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, role, content, status, sql, visualization, row_count, created_at';

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    ...(row.status !== null && { status: row.status }),
    ...(row.sql !== null && { sql: row.sql }),
    ...(row.visualization !== null && { visualization: row.visualization }),
    ...(row.row_count !== null && { rowCount: row.row_count }),
    createdAt: row.created_at.toISOString(),
  };
}

// Persistence of conversations and messages (schema `app`, role app_rw).
// Every statement is fixed text with bind parameters.
@Injectable()
export class ConversationRepository {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async create(): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      `INSERT INTO app.conversations DEFAULT VALUES RETURNING ${CONVERSATION_COLUMNS}`,
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('INSERT INTO app.conversations returned no row');
    }
    return toConversation(row);
  }

  async list(): Promise<Conversation[]> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM app.conversations
       ORDER BY updated_at DESC LIMIT $1`,
      [MAX_LISTED_CONVERSATIONS],
    );
    return result.rows.map(toConversation);
  }

  async exists(conversationId: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM app.conversations WHERE id = $1', [
      conversationId,
    ]);
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
    await this.pool.query('UPDATE app.conversations SET updated_at = now() WHERE id = $1', [
      conversationId,
    ]);
    return message;
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

  private async insertMessage(
    conversationId: string,
    role: MessageRole,
    input: Partial<AssistantMessageInput> & { content: string },
  ): Promise<ConversationMessage> {
    const result = await this.pool.query<MessageRow>(
      `INSERT INTO app.messages
         (conversation_id, role, content, status, sql, visualization, row_count, attempts,
          input_tokens, output_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('INSERT INTO app.messages returned no row');
    }
    return toMessage(row);
  }
}
