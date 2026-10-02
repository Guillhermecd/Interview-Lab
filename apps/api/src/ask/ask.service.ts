import { Inject, Injectable } from '@nestjs/common';
import type {
  AskResponse,
  QueryResult,
  TokenUsage,
  VisualizationSuggestion,
} from '@interview-lab/shared';
import { LlmError } from '../llm/llm-error.js';
import {
  LLM_PROVIDER,
  type LlmCallUsage,
  type LlmJsonRequest,
  type LlmProvider,
  type LlmTextRequest,
} from '../llm/llm-provider.js';
import { GuardedQueryService } from '../query/guarded-query.service.js';
import { QueryExecutionError, type QueryErrorCode } from '../query/query-error.js';
import { SchemaCatalog } from '../query/schema-catalog.service.js';
import {
  MAX_EXPLANATION_LENGTH,
  parseSqlGeneration,
  resolveVisualization,
  type ProposedVisualization,
} from './llm-output.js';
import {
  buildExplanationRequest,
  buildSqlRequest,
  type ConversationContext,
  type FailedAttempt,
} from './prompts.js';

export const ASK_LIMITS = Symbol('ASK_LIMITS');

export interface AskLimits {
  // Rows a query may return; told to the LLM so it can decide on a LIMIT.
  maxRows: number;
  // Rows of the result sent to the LLM for the explanation.
  explainMaxRows: number;
}

export interface AskInput {
  question: string;
  context?: ConversationContext;
}

// What happens while a question is being answered, in order.
export type AskEvent =
  | { type: 'sql'; sql: string; attempt: number }
  | { type: 'rows'; result: QueryResult; visualization: VisualizationSuggestion }
  | { type: 'token'; text: string };

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
  visualization: VisualizationSuggestion;
  attempts: number;
}

function describeFailure(error: QueryExecutionError): string {
  const details = error.details?.map((detail) => detail.message) ?? [];
  return [error.message, ...details].join(' ');
}

// Makes the LLM calls of one question, counting their tokens and passing the
// abort signal along.
class MeteredLlm {
  private readonly total: TokenUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(
    private readonly provider: LlmProvider,
    private readonly signal: AbortSignal | undefined,
  ) {}

  async generateJson(request: LlmJsonRequest): Promise<unknown> {
    const response = await this.provider.generateJson(request, this.options());
    this.add(response.usage);
    return response.data;
  }

  async *streamText(request: LlmTextRequest): AsyncGenerator<string> {
    let usage: LlmCallUsage | undefined;
    try {
      for await (const chunk of this.provider.streamText(request, this.options())) {
        usage = chunk.usage ?? usage;
        if (chunk.text !== '') {
          yield chunk.text;
        }
      }
    } finally {
      // Counted even if the stream was cut short: the tokens were spent.
      this.add(usage ?? { inputTokens: 0, outputTokens: 0 });
    }
  }

  get usage(): TokenUsage {
    return { ...this.total };
  }

  private options(): { signal?: AbortSignal } {
    return this.signal ? { signal: this.signal } : {};
  }

  private add(usage: LlmCallUsage): void {
    this.total.inputTokens += usage.inputTokens;
    this.total.outputTokens += usage.outputTokens;
    this.total.calls += 1;
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

  // Answers the question, yielding each step as it happens; the final answer is
  // the generator's return value. Aborting `signal` stops the LLM call or the
  // database query in progress.
  async *stream(input: AskInput, signal?: AbortSignal): AsyncGenerator<AskEvent, AskResponse> {
    const { question } = input;
    const llm = new MeteredLlm(this.provider, signal);

    const execution = yield* this.generateAndExecute(input, llm, signal);
    if ('reason' in execution) {
      yield { type: 'token', text: execution.reason };
      return { status: 'not_answerable', question, reason: execution.reason, usage: llm.usage };
    }

    yield { type: 'rows', result: execution.result, visualization: execution.visualization };

    // Rows read from the database go to the LLM only to be described. Its
    // answer is plain text, capped in length, and never interpreted.
    let explanation = '';
    const request = buildExplanationRequest({
      question,
      sql: execution.sql,
      result: execution.result,
      maxRows: this.limits.explainMaxRows,
    });
    for await (const text of llm.streamText(request)) {
      const accepted = text.slice(0, MAX_EXPLANATION_LENGTH - explanation.length);
      if (accepted !== '') {
        explanation += accepted;
        yield { type: 'token', text: accepted };
      }
    }
    if (explanation.trim() === '') {
      throw new LlmError('LLM_INVALID_RESPONSE');
    }

    return {
      status: 'answered',
      question,
      sql: execution.sql,
      result: execution.result,
      explanation: explanation.trim(),
      visualization: execution.visualization,
      attempts: execution.attempts,
      usage: llm.usage,
    };
  }

  // Same as stream(), for callers that only want the final answer.
  async ask(question: string): Promise<AskResponse> {
    const events = this.stream({ question });
    for (;;) {
      const step = await events.next();
      if (step.done === true) {
        return step.value;
      }
    }
  }

  private async *generateAndExecute(
    input: AskInput,
    llm: MeteredLlm,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<AskEvent, Execution | { reason: string }> {
    const schema = await this.schemaCatalog.describe();
    let previous: FailedAttempt | undefined;

    for (let attempt = 1; ; attempt += 1) {
      const generation = parseSqlGeneration(
        await llm.generateJson(
          buildSqlRequest({
            question: input.question,
            schema,
            maxRows: this.limits.maxRows,
            ...(input.context && { context: input.context }),
            ...(previous && { previous }),
          }),
        ),
      );
      if (generation.kind === 'refusal') {
        return { reason: generation.reason };
      }

      yield { type: 'sql', sql: generation.sql, attempt };

      try {
        return await this.execute(generation.sql, generation.visualization, attempt, signal);
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

  private async execute(
    sql: string,
    proposed: ProposedVisualization,
    attempts: number,
    signal: AbortSignal | undefined,
  ): Promise<Execution> {
    // The guard runs inside GuardedQueryService: SQL written by the LLM is
    // never executed without it.
    const result = await this.queries.run(sql, signal);
    return {
      sql,
      result,
      visualization: resolveVisualization(proposed, result.columns),
      attempts,
    };
  }
}
