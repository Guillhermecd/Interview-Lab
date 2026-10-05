import { Inject, Injectable } from '@nestjs/common';
import type {
  AnsweredQuestion,
  AskResponse,
  QueryResult,
  TokenUsage,
  UnansweredQuestion,
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
import { ANSWER_CACHE, type AnswerCache } from './answer-cache.js';
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

// Review mode: SQL generated and accepted by the guard, waiting for the user.
export interface SqlForReview {
  status: 'pending_review';
  question: string;
  sql: string;
  // Checked against the real columns only when the SQL runs.
  proposedVisualization: ProposedVisualization;
  attempts: number;
  usage: TokenUsage;
}

export interface ReviewedSqlInput {
  question: string;
  // The SQL to run: the generated one, as is or edited by the user.
  sql: string;
  proposedVisualization: ProposedVisualization;
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

interface Generated<T> {
  sql: string;
  proposedVisualization: ProposedVisualization;
  attempts: number;
  // True when the SQL came from the cache instead of the LLM.
  cached: boolean;
  // What the attempt function produced for the accepted SQL.
  outcome: T;
}

interface Refusal {
  reason: string;
}

function hasHistory(context: ConversationContext | undefined): boolean {
  return context !== undefined && (context.summary !== undefined || context.recent.length > 0);
}

function describeFailure(error: QueryExecutionError): string {
  const details = error.details?.map((detail) => detail.message) ?? [];
  return [error.message, ...details].join(' ');
}

function isRefusal<T>(value: Generated<T> | Refusal): value is Refusal {
  return 'reason' in value;
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

// Question in natural language → SQL → guard → execution → explanation. In
// review mode the flow stops after the guard and resumes, with the SQL the
// user approved or edited, in streamReviewedExecution().
@Injectable()
export class AskService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(SchemaCatalog) private readonly schemaCatalog: Pick<SchemaCatalog, 'describe'>,
    @Inject(GuardedQueryService)
    private readonly queries: Pick<GuardedQueryService, 'run' | 'check'>,
    @Inject(ASK_LIMITS) private readonly limits: AskLimits,
    @Inject(ANSWER_CACHE) private readonly cache: AnswerCache,
  ) {}

  // Answers the question, yielding each step as it happens; the final answer is
  // the generator's return value. Aborting `signal` stops the LLM call or the
  // database query in progress.
  async *stream(input: AskInput, signal?: AbortSignal): AsyncGenerator<AskEvent, AskResponse> {
    const llm = new MeteredLlm(this.provider, signal);

    const generated = yield* this.generate(input, llm, (sql, version) =>
      this.runCached(sql, version, signal),
    );
    if (isRefusal(generated)) {
      return yield* this.refuse(input.question, generated.reason, llm);
    }

    return yield* this.explain(
      input.question,
      generated.sql,
      generated.outcome,
      resolveVisualization(generated.proposedVisualization, generated.outcome.columns),
      generated.attempts,
      generated.cached,
      llm,
    );
  }

  // Review mode: generates the SQL and checks it with the guard, without
  // running it. The SQL shown to the user has already passed the guard once.
  async *streamReview(
    input: AskInput,
    signal?: AbortSignal,
  ): AsyncGenerator<AskEvent, SqlForReview | UnansweredQuestion> {
    const llm = new MeteredLlm(this.provider, signal);

    const generated = yield* this.generate(input, llm, (sql) => {
      this.queries.check(sql);
      return Promise.resolve();
    });
    if (isRefusal(generated)) {
      return yield* this.refuse(input.question, generated.reason, llm);
    }

    return {
      status: 'pending_review',
      question: input.question,
      sql: generated.sql,
      proposedVisualization: generated.proposedVisualization,
      attempts: generated.attempts,
      usage: llm.usage,
    };
  }

  // Runs the SQL approved or edited by the user and explains it. The SQL goes
  // through the guard again: what the user sends is never trusted (rule 2).
  // There is no new attempt: a refused SQL goes back to the user.
  async *streamReviewedExecution(
    input: ReviewedSqlInput,
    signal?: AbortSignal,
  ): AsyncGenerator<AskEvent, AnsweredQuestion> {
    const llm = new MeteredLlm(this.provider, signal);
    const { version } = await this.schemaCatalog.describe();
    const result = await this.runCached(input.sql, version, signal);

    return yield* this.explain(
      input.question,
      input.sql,
      result,
      resolveVisualization(input.proposedVisualization, result.columns),
      1,
      false,
      llm,
    );
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

  // Asks the LLM for SQL and hands it to `attempt` (run it, or only check it).
  // If the SQL is refused because of its text, the LLM gets one more try with
  // the reason.
  private async *generate<T>(
    input: AskInput,
    llm: MeteredLlm,
    attempt: (sql: string, schemaVersion: string) => Promise<T>,
  ): AsyncGenerator<AskEvent, Generated<T> | Refusal> {
    const schema = await this.schemaCatalog.describe();
    // Only a question that does not depend on earlier messages can reuse the
    // SQL generated for the same question before.
    const cacheable = !hasHistory(input.context);

    if (cacheable) {
      const cached = yield* this.tryCachedSql(input.question, schema.version, attempt);
      if (cached) {
        return cached;
      }
    }

    let previous: FailedAttempt | undefined;

    for (let attemptNumber = 1; ; attemptNumber += 1) {
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

      yield { type: 'sql', sql: generation.sql, attempt: attemptNumber };

      try {
        const outcome = await attempt(generation.sql, schema.version);
        if (cacheable) {
          await this.cache.setSql(input.question, schema.version, {
            sql: generation.sql,
            proposedVisualization: generation.visualization,
          });
        }
        return {
          sql: generation.sql,
          proposedVisualization: generation.visualization,
          attempts: attemptNumber,
          cached: false,
          outcome,
        };
      } catch (error) {
        const retryable =
          error instanceof QueryExecutionError &&
          RETRYABLE_ERRORS.has(error.code) &&
          attemptNumber < MAX_SQL_ATTEMPTS;
        if (!retryable) {
          throw error;
        }
        previous = { sql: generation.sql, error: describeFailure(error) };
      }
    }
  }

  // A cached SQL still goes through `attempt` (the guard, and the database).
  // If it fails now, the entry is dropped and the LLM writes a new one.
  private async *tryCachedSql<T>(
    question: string,
    schemaVersion: string,
    attempt: (sql: string, schemaVersion: string) => Promise<T>,
  ): AsyncGenerator<AskEvent, Generated<T> | undefined> {
    const cached = await this.cache.getSql(question, schemaVersion);
    if (cached === undefined) {
      return undefined;
    }
    yield { type: 'sql', sql: cached.sql, attempt: 1 };
    try {
      return {
        sql: cached.sql,
        proposedVisualization: cached.proposedVisualization,
        attempts: 1,
        cached: true,
        outcome: await attempt(cached.sql, schemaVersion),
      };
    } catch (error) {
      if (!(error instanceof QueryExecutionError) || !RETRYABLE_ERRORS.has(error.code)) {
        throw error;
      }
      await this.cache.deleteSql(question, schemaVersion);
      return undefined;
    }
  }

  // Results of the same SQL are reused for a short time (RESULT_CACHE_TTL_SECONDS).
  private async runCached(
    sql: string,
    schemaVersion: string,
    signal: AbortSignal | undefined,
  ): Promise<QueryResult> {
    // The slot is taken before the query runs, so a result computed on data
    // that changed meanwhile is never stored where later questions look.
    const slot = await this.cache.lookupResult(sql, schemaVersion);
    if (slot.cached) {
      return slot.cached;
    }
    const result = await this.queries.run(sql, signal);
    await slot.store(result);
    return result;
  }

  private *refuse(
    question: string,
    reason: string,
    llm: MeteredLlm,
  ): Generator<AskEvent, UnansweredQuestion> {
    yield { type: 'token', text: reason };
    return { status: 'not_answerable', question, reason, usage: llm.usage };
  }

  // Rows read from the database go to the LLM only to be described. Its answer
  // is plain text, capped in length, and never interpreted.
  private async *explain(
    question: string,
    sql: string,
    result: QueryResult,
    visualization: VisualizationSuggestion,
    attempts: number,
    cached: boolean,
    llm: MeteredLlm,
  ): AsyncGenerator<AskEvent, AnsweredQuestion> {
    yield { type: 'rows', result, visualization };

    let explanation = '';
    const request = buildExplanationRequest({
      question,
      sql,
      result,
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
      sql,
      result,
      explanation: explanation.trim(),
      visualization,
      attempts,
      cached,
      usage: llm.usage,
    };
  }
}
