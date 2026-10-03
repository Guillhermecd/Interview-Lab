import { Inject, Injectable } from '@nestjs/common';
import type { TokenUsage, UsageSummary } from '@interview-lab/shared';
import type { Pool } from 'pg';
import { APP_POOL } from '../conversation/app-pool.js';

export type UsageKind = 'answer' | 'review' | 'execution' | 'summary';

interface TotalsRow {
  input_tokens: string;
  output_tokens: string;
  calls: string;
}

interface ConversationRow {
  conversation_id: string;
  title: string | null;
  tokens: string;
}

// "Today" is the UTC day, the same everywhere the quota is checked.
const TODAY = "created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";

// Durable record of the tokens spent with the LLM (D-07b: accounting stays in
// PostgreSQL), per user and conversation.
@Injectable()
export class UsageRepository {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async record(
    userId: string,
    conversationId: string | undefined,
    kind: UsageKind,
    usage: TokenUsage,
  ): Promise<void> {
    if (usage.calls === 0) {
      return;
    }
    await this.pool.query(
      `INSERT INTO app.token_usage
         (user_id, conversation_id, kind, input_tokens, output_tokens, calls)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, conversationId ?? null, kind, usage.inputTokens, usage.outputTokens, usage.calls],
    );
  }

  async todayTotal(userId: string): Promise<TokenUsage> {
    const result = await this.pool.query<TotalsRow>(
      `SELECT coalesce(sum(input_tokens), 0) AS input_tokens,
              coalesce(sum(output_tokens), 0) AS output_tokens,
              coalesce(sum(calls), 0) AS calls
       FROM app.token_usage WHERE user_id = $1 AND ${TODAY}`,
      [userId],
    );
    const row = result.rows[0];
    return {
      inputTokens: Number(row?.input_tokens ?? 0),
      outputTokens: Number(row?.output_tokens ?? 0),
      calls: Number(row?.calls ?? 0),
    };
  }

  async todayByConversation(userId: string): Promise<UsageSummary['byConversation']> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT u.conversation_id, c.title, sum(u.input_tokens + u.output_tokens) AS tokens
       FROM app.token_usage u
       JOIN app.conversations c ON c.id = u.conversation_id
       WHERE u.user_id = $1 AND u.${TODAY}
       GROUP BY u.conversation_id, c.title
       ORDER BY tokens DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id,
      title: row.title,
      tokens: Number(row.tokens),
    }));
  }
}
