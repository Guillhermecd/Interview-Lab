import type { QueryResult } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import {
  explanationAnswer,
  refusalAnswer,
  ScriptedLlmProvider,
  sqlAnswer,
} from '../../test/support/scripted-llm-provider.js';
import { QueryExecutionError } from '../query/query-error.js';
import type { SchemaDescription } from '../query/schema-catalog.service.js';
import { AskService } from './ask.service.js';

const SCHEMA: SchemaDescription = {
  tables: [
    {
      name: 'regions',
      columns: [{ name: 'name', type: 'text', nullable: false }],
      constraints: [],
    },
  ],
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

// Answers each run() with the next outcome and records the SQL it received.
class FakeQueries {
  readonly executed: string[] = [];

  constructor(private readonly outcomes: RunOutcome[]) {}

  run(sql: string): Promise<QueryResult> {
    this.executed.push(sql);
    const outcome = this.outcomes.shift();
    if (outcome === undefined) {
      return Promise.reject(new Error('FakeQueries has no outcome left'));
    }
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }
}

function setup(answers: unknown[], outcomes: RunOutcome[]) {
  const provider = new ScriptedLlmProvider(answers);
  const queries = new FakeQueries(outcomes);
  const service = new AskService(provider, { describe: () => Promise.resolve(SCHEMA) }, queries, {
    maxRows: 1000,
    explainMaxRows: 50,
  });
  return { provider, queries, service };
}

function rejected(message: string): QueryExecutionError {
  return new QueryExecutionError('QUERY_REJECTED', [{ field: 'sql', message }]);
}

describe('AskService', () => {
  it('generates SQL, executes it and explains the result', async () => {
    const { service, queries } = setup(
      [
        sqlAnswer('SELECT regiao, pedidos FROM x'),
        explanationAnswer('O Sul tem mais pedidos.', 'bar', 'regiao', 'pedidos'),
      ],
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

  it('gives the schema and the question to the LLM', async () => {
    const { service, provider } = setup(
      [sqlAnswer('SELECT 1'), explanationAnswer('Ok.')],
      [RESULT],
    );

    await service.ask(QUESTION);

    expect(provider.requests[0]?.prompt).toContain('Table regions');
    expect(provider.requests[0]?.prompt).toContain(QUESTION);
  });

  it('gives the question, the SQL and the rows to the LLM for the explanation', async () => {
    const { service, provider } = setup(
      [sqlAnswer('SELECT 1'), explanationAnswer('Ok.')],
      [RESULT],
    );

    await service.ask(QUESTION);

    const explanationPrompt = provider.requests[1]?.prompt;
    expect(explanationPrompt).toContain(QUESTION);
    expect(explanationPrompt).toContain('SELECT 1');
    expect(explanationPrompt).toContain('"Sul"');
  });

  describe('when the first SQL is refused', () => {
    it('asks for a new SQL once, telling the LLM why, and answers with the second', async () => {
      const { service, provider, queries } = setup(
        [
          sqlAnswer('SELECT * FROM invoices'),
          sqlAnswer('SELECT * FROM orders'),
          explanationAnswer('Ok.'),
        ],
        [rejected('A tabela "invoices" não está disponível.'), RESULT],
      );

      const response = await service.ask(QUESTION);

      expect(response).toMatchObject({
        status: 'answered',
        sql: 'SELECT * FROM orders',
        attempts: 2,
        usage: { calls: 3, inputTokens: 300, outputTokens: 60 },
      });
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
        [sqlAnswer('SELECT bad'), sqlAnswer('SELECT good'), explanationAnswer('Ok.')],
        [new QueryExecutionError(code), RESULT],
      );

      await expect(service.ask(QUESTION)).resolves.toMatchObject({ attempts: 2 });
    });

    it('gives up after the second refusal, without a third attempt', async () => {
      const { service, provider, queries } = setup(
        [sqlAnswer('SELECT bad'), sqlAnswer('SELECT still bad'), sqlAnswer('SELECT never asked')],
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

  it.each(['QUERY_TIMEOUT', 'DATABASE_UNAVAILABLE', 'QUERY_FAILED'] as const)(
    'does not retry after %s',
    async (code) => {
      const { service, provider } = setup(
        [sqlAnswer('SELECT 1'), sqlAnswer('SELECT never asked')],
        [new QueryExecutionError(code), RESULT],
      );

      await expect(service.ask(QUESTION)).rejects.toMatchObject({ code });
      expect(provider.requests).toHaveLength(1);
    },
  );

  it('does not run anything when the LLM says the question cannot be answered', async () => {
    const { service, queries } = setup([refusalAnswer('Não há dados de estoque.')], []);

    await expect(service.ask(QUESTION)).resolves.toEqual({
      status: 'not_answerable',
      question: QUESTION,
      reason: 'Não há dados de estoque.',
      usage: { inputTokens: 100, outputTokens: 20, calls: 1 },
    });
    expect(queries.executed).toEqual([]);
  });

  it('fails when the LLM returns neither SQL nor a reason', async () => {
    const { service, queries } = setup([{ sql: '', cannotAnswerReason: '' }], []);

    await expect(service.ask(QUESTION)).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
    expect(queries.executed).toEqual([]);
  });

  it('fails when the explanation is unusable', async () => {
    const { service } = setup([sqlAnswer('SELECT 1'), { explanation: '' }], [RESULT]);

    await expect(service.ask(QUESTION)).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
  });

  it('downgrades an invalid chart suggestion to a table', async () => {
    const { service } = setup(
      [sqlAnswer('SELECT 1'), explanationAnswer('Ok.', 'bar', 'coluna_inexistente', 'pedidos')],
      [RESULT],
    );

    await expect(service.ask(QUESTION)).resolves.toMatchObject({
      visualization: { type: 'table' },
    });
  });
});
