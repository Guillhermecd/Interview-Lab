import { Inject, Injectable } from '@nestjs/common';
import type { AskResponse, QueryResult, TokenUsage } from '@interview-lab/shared';
import { LLM_PROVIDER, type LlmJsonRequest, type LlmProvider } from '../llm/llm-provider.js';
import { GuardedQueryService } from '../query/guarded-query.service.js';
import { QueryExecutionError, type QueryErrorCode } from '../query/query-error.js';
import { SchemaCatalog } from '../query/schema-catalog.service.js';
import { parseExplanation, parseSqlGeneration } from './llm-output.js';
import { buildExplanationRequest, buildSqlRequest, type FailedAttempt } from './prompts.js';

export const ASK_LIMITS = Symbol('ASK_LIMITS');

export interface AskLimits {
  // Rows a query may return; told to the LLM so it can decide on a LIMIT.
  maxRows: number;
  // Rows of the result sent to the LLM for the explanation.
  explainMaxRows: number;
}

const MAX_SQL_ATTEMPTS = 2;

// Failures caused by the SQL text itself: worth one new attempt, telling the
// LLM what went wrong. Timeouts and an unavailable database are not.
const RETRYABLE_ERRORS: ReadonlySet<QueryErrorCode> = new Set([
  'QUERY_REJECTED',
  'QUERY_SYNTAX_ERROR',
  'QUERY_INVALID_REFERENCE',
  'QUERY_NOT_ALLOWED',
  'QUERY_DATA_ERROR',
]);

interface Execution {
  sql: string;
  result: QueryResult;
  attempts: number;
}

function describeFailure(error: QueryExecutionError): string {
  const details = error.details?.map((detail) => detail.message) ?? [];
  return [error.message, ...details].join(' ');
}

// Counts tokens across the calls made for one question.
class UsageMeter {
  private readonly total: TokenUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(private readonly provider: LlmProvider) {}

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const response = await this.provider.generateJson(request);
    this.total.inputTokens += response.usage.inputTokens;
    this.total.outputTokens += response.usage.outputTokens;
    this.total.calls += 1;
    return response.data;
  }

  get usage(): TokenUsage {
    return { ...this.total };
  }
}

// Question in natural language → SQL → guard → execution → explanation.
@Injectable()
export class AskService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(SchemaCatalog) private readonly schemaCatalog: Pick<SchemaCatalog, 'describe'>,
    @Inject(GuardedQueryService) private readonly queries: Pick<GuardedQueryService, 'run'>,
    @Inject(ASK_LIMITS) private readonly limits: AskLimits,
  ) {}

  async ask(question: string): Promise<AskResponse> {
    const llm = new UsageMeter(this.provider);

    const execution = await this.generateAndExecute(question, llm);
    if ('reason' in execution) {
      return { status: 'not_answerable', question, reason: execution.reason, usage: llm.usage };
    }

    // Rows read from the database go to the LLM only to be described, and its
    // answer is validated before use (see parseExplanation).
    const explained = parseExplanation(
      await llm.generateJson(
        buildExplanationRequest({
          question,
          sql: execution.sql,
          result: execution.result,
          maxRows: this.limits.explainMaxRows,
        }),
      ),
      execution.result.columns,
    );

    return {
      status: 'answered',
      question,
      sql: execution.sql,
      result: execution.result,
      explanation: explained.explanation,
      visualization: explained.visualization,
      attempts: execution.attempts,
      usage: llm.usage,
    };
  }

  private async generateAndExecute(
    question: string,
    llm: UsageMeter,
  ): Promise<Execution | { reason: string }> {
    const schema = await this.schemaCatalog.describe();
    let previous: FailedAttempt | undefined;

    for (let attempt = 1; ; attempt += 1) {
      const generation = parseSqlGeneration(
        await llm.generateJson(
          buildSqlRequest({
            question,
            schema,
            maxRows: this.limits.maxRows,
            ...(previous && { previous }),
          }),
        ),
      );
      if (generation.kind === 'refusal') {
        return { reason: generation.reason };
      }

      try {
        // The guard runs inside GuardedQueryService: SQL written by the LLM is
        // never executed without it.
        const result = await this.queries.run(generation.sql);
        return { sql: generation.sql, result, attempts: attempt };
      } catch (error) {
        const retryable =
          error instanceof QueryExecutionError &&
          RETRYABLE_ERRORS.has(error.code) &&
          attempt < MAX_SQL_ATTEMPTS;
        if (!retryable) {
          throw error;
        }
        previous = { sql: generation.sql, error: describeFailure(error) };
      }
    }
  }
}
