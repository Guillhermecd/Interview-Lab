import type { QueryResult } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import {
  refusalAnswer,
  ScriptedLlmProvider,
  sqlAnswer,
} from '../../test/support/scripted-llm-provider.js';
import { LlmError } from '../llm/llm-error.js';
import { QueryExecutionError } from '../query/query-error.js';
import type { SchemaDescription } from '../query/schema-catalog.service.js';
import { NoAnswerCache, type AnswerCache, type CachedSql } from './answer-cache.js';
import { AskService, type AskEvent } from './ask.service.js';

const SCHEMA: SchemaDescription = {
  tables: [
    {
      name: 'regions',
      columns: [{ name: 'name', type: 'text', nullable: false }],
      constraints: [],
    },
  ],
  version: 'test-schema-v1',
};

const RESULT: QueryResult = {
  columns: [
    { name: 'regiao', type: 'text' },
    { name: 'pedidos', type: 'int8' },
  ],
  rows: [
    ['Sul', '10'],
    ['Norte', '7'],
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 3,
};

const QUESTION = 'Quantos pedidos por região?';

type RunOutcome = QueryResult | Error;

// Answers each run() or check() with the next outcome and records what it
// received. check() only uses the outcome to decide whether to throw.
class FakeQueries {
  readonly executed: string[] = [];
  readonly checked: string[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];

  constructor(private readonly outcomes: RunOutcome[]) {}

  run(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    this.executed.push(sql);
    this.signals.push(signal);
    const outcome = this.outcomes.shift();
    if (outcome === undefined) {
      return Promise.reject(new Error('FakeQueries has no outcome left'));
    }
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }

  check(sql: string): void {
    this.checked.push(sql);
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error) {
      throw outcome;
    }
  }
}

// In-memory cache of generated SQL; results are never cached here.
class MemorySqlCache implements AnswerCache {
  readonly sql = new Map<string, CachedSql>();

  getSql(question: string): Promise<CachedSql | undefined> {
    return Promise.resolve(this.sql.get(question));
  }
  setSql(question: string, _version: string, value: CachedSql): Promise<void> {
    this.sql.set(question, value);
    return Promise.resolve();
  }
  deleteSql(question: string): Promise<void> {
    this.sql.delete(question);
    return Promise.resolve();
  }
  getResult(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  setResult(): Promise<void> {
    return Promise.resolve();
  }
}

function setup(
  jsonAnswers: unknown[],
  texts: (string | Error)[],
  outcomes: RunOutcome[],
  cache: AnswerCache = new NoAnswerCache(),
) {
  const provider = new ScriptedLlmProvider(jsonAnswers, texts);
  const queries = new FakeQueries(outcomes);
  const service = new AskService(
    provider,
    { describe: () => Promise.resolve(SCHEMA) },
    queries,
    {
      maxRows: 1000,
      explainMaxRows: 50,
    },
    cache,
  );
  return { provider, queries, service };
}

async function collect<T>(
  stream: AsyncGenerator<AskEvent, T>,
): Promise<{ events: AskEvent[]; answer: T }> {
  const events: AskEvent[] = [];
  for (;;) {
    const step = await stream.next();
    if (step.done === true) {
      return { events, answer: step.value };
    }
    events.push(step.value);
  }
}

function rejected(message: string): QueryExecutionError {
  return new QueryExecutionError('QUERY_REJECTED', [{ field: 'sql', message }]);
}

describe('AskService', () => {
  it('generates SQL, executes it and explains the result', async () => {
    const { service, queries } = setup(
      [sqlAnswer('SELECT regiao, pedidos FROM x', 'bar', 'regiao', 'pedidos')],
      ['O Sul tem mais pedidos.'],
      [RESULT],
    );

    await expect(service.ask(QUESTION)).resolves.toEqual({
      status: 'answered',
      question: QUESTION,
      sql: 'SELECT regiao, pedidos FROM x',
      result: RESULT,
      explanation: 'O Sul tem mais pedidos.',
      visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' },
      attempts: 1,
      usage: { inputTokens: 200, outputTokens: 40, calls: 2 },
    });
    expect(queries.executed).toEqual(['SELECT regiao, pedidos FROM x']);
  });

  it('emits sql, then rows, then the explanation token by token', async () => {
    const { service } = setup(
      [sqlAnswer('SELECT 1', 'bar', 'regiao', 'pedidos')],
      ['O Sul lidera.'],
      [RESULT],
    );

    const { events } = await collect(service.stream({ question: QUESTION }));

    expect(events).toEqual([
      { type: 'sql', sql: 'SELECT 1', attempt: 1 },
      {
        type: 'rows',
        result: RESULT,
        visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' },
      },
      { type: 'token', text: 'O ' },
      { type: 'token', text: 'Sul ' },
      { type: 'token', text: 'lidera.' },
    ]);
  });

  it('gives the schema and the question to the LLM', async () => {
    const { service, provider } = setup([sqlAnswer('SELECT 1')], ['Ok.'], [RESULT]);

    await service.ask(QUESTION);

    expect(provider.requests[0]?.prompt).toContain('Table regions');
    expect(provider.requests[0]?.prompt).toContain(QUESTION);
  });

  it('gives the conversation history to the LLM when there is one', async () => {
    const { service, provider } = setup([sqlAnswer('SELECT 1')], ['Ok.'], [RESULT]);

    await collect(
      service.stream({
        question: 'E por produto?',
        context: {
          summary: 'O usuário analisa vendas de 2026.',
          recent: [
            { role: 'user', content: 'Faturamento por região?' },
            { role: 'assistant', content: 'O Sul lidera.', sql: 'SELECT regiao FROM x' },
          ],
        },
      }),
    );

    const prompt = provider.requests[0]?.prompt;
    expect(prompt).toContain('summary of earlier messages: O usuário analisa vendas de 2026.');
    expect(prompt).toContain('user: Faturamento por região?');
    expect(prompt).toContain('sql: SELECT regiao FROM x');
    expect(prompt).toContain('<question>\nE por produto?\n</question>');
  });

  it('gives the question, the SQL and the rows to the LLM for the explanation', async () => {
    const { service, provider } = setup([sqlAnswer('SELECT 1')], ['Ok.'], [RESULT]);

    await service.ask(QUESTION);

    const explanationPrompt = provider.textRequests[0]?.prompt;
    expect(explanationPrompt).toContain(QUESTION);
    expect(explanationPrompt).toContain('SELECT 1');
    expect(explanationPrompt).toContain('"Sul"');
  });

  describe('when the first SQL is refused', () => {
    it('asks for a new SQL once, telling the LLM why, and answers with the second', async () => {
      const { service, provider, queries } = setup(
        [sqlAnswer('SELECT * FROM invoices'), sqlAnswer('SELECT * FROM orders')],
        ['Ok.'],
        [rejected('A tabela "invoices" não está disponível.'), RESULT],
      );

      const { events, answer } = await collect(service.stream({ question: QUESTION }));

      expect(answer).toMatchObject({
        status: 'answered',
        sql: 'SELECT * FROM orders',
        attempts: 2,
        usage: { calls: 3, inputTokens: 300, outputTokens: 60 },
      });
      expect(events.filter((event) => event.type === 'sql')).toEqual([
        { type: 'sql', sql: 'SELECT * FROM invoices', attempt: 1 },
        { type: 'sql', sql: 'SELECT * FROM orders', attempt: 2 },
      ]);
      expect(queries.executed).toEqual(['SELECT * FROM invoices', 'SELECT * FROM orders']);
      expect(provider.requests[1]?.prompt).toContain('SELECT * FROM invoices');
      expect(provider.requests[1]?.prompt).toContain('A tabela "invoices" não está disponível.');
    });

    it.each([
      'QUERY_REJECTED',
      'QUERY_SYNTAX_ERROR',
      'QUERY_INVALID_REFERENCE',
      'QUERY_NOT_ALLOWED',
      'QUERY_DATA_ERROR',
    ] as const)('retries after %s', async (code) => {
      const { service } = setup(
        [sqlAnswer('SELECT bad'), sqlAnswer('SELECT good')],
        ['Ok.'],
        [new QueryExecutionError(code), RESULT],
      );

      await expect(service.ask(QUESTION)).resolves.toMatchObject({ attempts: 2 });
    });

    it('gives up after the second refusal, without a third attempt', async () => {
      const { service, provider, queries } = setup(
        [sqlAnswer('SELECT bad'), sqlAnswer('SELECT still bad'), sqlAnswer('SELECT never asked')],
        [],
        [rejected('first'), rejected('second'), RESULT],
      );

      await expect(service.ask(QUESTION)).rejects.toMatchObject({
        code: 'QUERY_REJECTED',
        details: [{ field: 'sql', message: 'second' }],
      });
      expect(queries.executed).toEqual(['SELECT bad', 'SELECT still bad']);
      expect(provider.requests).toHaveLength(2);
    });
  });

  it.each(['QUERY_TIMEOUT', 'QUERY_CANCELLED', 'DATABASE_UNAVAILABLE', 'QUERY_FAILED'] as const)(
    'does not retry after %s',
    async (code) => {
      const { service, provider } = setup(
        [sqlAnswer('SELECT 1'), sqlAnswer('SELECT never asked')],
        [],
        [new QueryExecutionError(code), RESULT],
      );

      await expect(service.ask(QUESTION)).rejects.toMatchObject({ code });
      expect(provider.requests).toHaveLength(1);
    },
  );

  it('does not run anything when the LLM says the question cannot be answered', async () => {
    const { service, queries } = setup([refusalAnswer('Não há dados de estoque.')], [], []);

    const { events, answer } = await collect(service.stream({ question: QUESTION }));

    expect(answer).toEqual({
      status: 'not_answerable',
      question: QUESTION,
      reason: 'Não há dados de estoque.',
      usage: { inputTokens: 100, outputTokens: 20, calls: 1 },
    });
    expect(events).toEqual([{ type: 'token', text: 'Não há dados de estoque.' }]);
    expect(queries.executed).toEqual([]);
  });

  it('fails when the LLM returns neither SQL nor a reason', async () => {
    const { service, queries } = setup([{ sql: '', cannotAnswerReason: '' }], [], []);

    await expect(service.ask(QUESTION)).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(queries.executed).toEqual([]);
  });

  it('fails when the explanation is empty', async () => {
    const { service } = setup([sqlAnswer('SELECT 1')], ['   '], [RESULT]);

    await expect(service.ask(QUESTION)).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
  });

  it('fails when the provider breaks in the middle of the explanation', async () => {
    const { service } = setup([sqlAnswer('SELECT 1')], [new LlmError('LLM_UNAVAILABLE')], [RESULT]);

    await expect(service.ask(QUESTION)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });

  it('cuts an explanation that grows beyond the limit', async () => {
    const { service } = setup([sqlAnswer('SELECT 1')], ['palavra '.repeat(1000)], [RESULT]);

    const answer = await service.ask(QUESTION);

    expect(answer.status === 'answered' && answer.explanation.length).toBeLessThanOrEqual(2000);
  });

  it('downgrades an invalid chart suggestion to a table', async () => {
    const { service } = setup(
      [sqlAnswer('SELECT 1', 'bar', 'coluna_inexistente', 'pedidos')],
      ['Ok.'],
      [RESULT],
    );

    await expect(service.ask(QUESTION)).resolves.toMatchObject({
      visualization: { type: 'table' },
    });
  });

  it('passes the abort signal on to the query', async () => {
    const { service, queries } = setup([sqlAnswer('SELECT 1')], ['Ok.'], [RESULT]);
    const abort = new AbortController();

    await collect(service.stream({ question: QUESTION }, abort.signal));

    expect(queries.signals).toEqual([abort.signal]);
  });

  it('stops streaming the explanation when aborted', async () => {
    const { service, provider } = setup([sqlAnswer('SELECT 1')], ['um dois três'], [RESULT]);
    const abort = new AbortController();
    const stream = service.stream({ question: QUESTION }, abort.signal);

    const seen: AskEvent[] = [];
    const drain = (async () => {
      for await (const event of stream) {
        seen.push(event);
        if (event.type === 'token') {
          abort.abort();
        }
      }
    })();

    await expect(drain).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
    expect(seen.filter((event) => event.type === 'token')).toHaveLength(1);
    expect(provider.streamAborted).toBe(true);
  });
});

describe('AskService review mode', () => {
  it('generates and checks the SQL without running it', async () => {
    const { service, queries } = setup(
      [sqlAnswer('SELECT regiao, pedidos FROM x', 'bar', 'regiao', 'pedidos')],
      [],
      [RESULT],
    );

    const { events, answer } = await collect(service.streamReview({ question: QUESTION }));

    expect(events).toEqual([{ type: 'sql', sql: 'SELECT regiao, pedidos FROM x', attempt: 1 }]);
    expect(answer).toEqual({
      status: 'pending_review',
      question: QUESTION,
      sql: 'SELECT regiao, pedidos FROM x',
      proposedVisualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' },
      attempts: 1,
      usage: { inputTokens: 100, outputTokens: 20, calls: 1 },
    });
    expect(queries.checked).toEqual(['SELECT regiao, pedidos FROM x']);
    expect(queries.executed).toEqual([]);
  });

  it('asks for a new SQL when the guard refuses the first one', async () => {
    const { service, provider, queries } = setup(
      [sqlAnswer('SELECT * FROM pg_roles'), sqlAnswer('SELECT 1')],
      [],
      [rejected('A tabela "pg_roles" não está disponível.'), RESULT],
    );

    const { answer } = await collect(service.streamReview({ question: QUESTION }));

    expect(answer).toMatchObject({ status: 'pending_review', sql: 'SELECT 1', attempts: 2 });
    expect(provider.requests[1]?.prompt).toContain('A tabela "pg_roles" não está disponível.');
    expect(queries.executed).toEqual([]);
  });

  it('returns the refusal when the question cannot be answered', async () => {
    const { service } = setup([refusalAnswer('Não há dados de estoque.')], [], []);

    const { answer } = await collect(service.streamReview({ question: QUESTION }));

    expect(answer).toMatchObject({ status: 'not_answerable', reason: 'Não há dados de estoque.' });
  });

  it('runs the reviewed SQL and explains it', async () => {
    const { service, queries } = setup([], ['O Sul lidera.'], [RESULT]);

    const { events, answer } = await collect(
      service.streamReviewedExecution({
        question: QUESTION,
        sql: 'SELECT regiao, pedidos FROM y',
        proposedVisualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' },
      }),
    );

    expect(events.map((event) => event.type)).toEqual(['rows', 'token', 'token', 'token']);
    expect(answer).toMatchObject({
      status: 'answered',
      sql: 'SELECT regiao, pedidos FROM y',
      explanation: 'O Sul lidera.',
      visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'pedidos' },
      attempts: 1,
      usage: { calls: 1 },
    });
    expect(queries.executed).toEqual(['SELECT regiao, pedidos FROM y']);
  });

  it('falls back to a table when the edited SQL no longer has the proposed columns', async () => {
    const { service } = setup([], ['Ok.'], [RESULT]);

    const { answer } = await collect(
      service.streamReviewedExecution({
        question: QUESTION,
        sql: 'SELECT outra_coluna FROM y',
        proposedVisualization: { type: 'bar', xColumn: 'categoria', yColumn: 'total' },
      }),
    );

    expect(answer.visualization).toEqual({ type: 'table' });
  });

  it('does not retry nor ask the LLM when the reviewed SQL is refused', async () => {
    const { service, provider } = setup([], ['nunca'], [rejected('Apenas SELECT.')]);

    await expect(
      collect(
        service.streamReviewedExecution({
          question: QUESTION,
          sql: 'DELETE FROM regions',
          proposedVisualization: { type: '', xColumn: '', yColumn: '' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'QUERY_REJECTED' });
    expect(provider.requests).toHaveLength(0);
    expect(provider.textRequests).toHaveLength(0);
  });

  describe('cache of generated SQL', () => {
    it('uses the cached SQL without asking the LLM to generate it', async () => {
      const cache = new MemorySqlCache();
      cache.sql.set(QUESTION, { sql: 'SELECT cached', proposedVisualization: { type: 'table' } });
      const { service, provider, queries } = setup([], ['Explicação.'], [RESULT], cache);

      await expect(service.ask(QUESTION)).resolves.toMatchObject({
        status: 'answered',
        sql: 'SELECT cached',
      });
      expect(provider.requests).toHaveLength(0);
      expect(queries.executed).toEqual(['SELECT cached']);
    });

    it('sends cached SQL through the guard again, and regenerates it when refused', async () => {
      const cache = new MemorySqlCache();
      cache.sql.set(QUESTION, {
        sql: 'DELETE FROM regions',
        proposedVisualization: { type: 'table' },
      });
      const { service, provider, queries } = setup(
        [sqlAnswer('SELECT fresh')],
        ['Explicação.'],
        [rejected('Only SELECT statements are allowed.'), RESULT],
        cache,
      );

      await expect(service.ask(QUESTION)).resolves.toMatchObject({
        status: 'answered',
        sql: 'SELECT fresh',
      });
      expect(queries.executed).toEqual(['DELETE FROM regions', 'SELECT fresh']);
      expect(provider.requests).toHaveLength(1);
      expect(cache.sql.get(QUESTION)?.sql).toBe('SELECT fresh');
    });
  });
});
