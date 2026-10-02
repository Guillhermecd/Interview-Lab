import type { QueryColumn } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import { LlmError } from '../llm/llm-error.js';
import { parseExplanation, parseSqlGeneration } from './llm-output.js';

const COLUMNS: QueryColumn[] = [
  { name: 'regiao', type: 'text' },
  { name: 'faturamento', type: 'numeric' },
];

function expectInvalid(action: () => unknown): void {
  expect(action).toThrow(LlmError);
  expect(action).toThrow('O serviço de IA devolveu uma resposta que não pôde ser usada.');
}

describe('parseSqlGeneration', () => {
  it('reads the SQL', () => {
    expect(parseSqlGeneration({ sql: ' SELECT 1 ', cannotAnswerReason: '' })).toEqual({
      kind: 'sql',
      sql: 'SELECT 1',
    });
  });

  it('reads a refusal when there is no SQL', () => {
    expect(parseSqlGeneration({ sql: '', cannotAnswerReason: 'Não há dados de estoque.' })).toEqual(
      { kind: 'refusal', reason: 'Não há dados de estoque.' },
    );
  });

  it('prefers the SQL when both fields are filled', () => {
    expect(parseSqlGeneration({ sql: 'SELECT 1', cannotAnswerReason: 'x' }).kind).toBe('sql');
  });

  it('cuts an overlong refusal reason', () => {
    const generation = parseSqlGeneration({ sql: '', cannotAnswerReason: 'x'.repeat(5000) });

    expect(generation).toMatchObject({ kind: 'refusal' });
    expect(generation.kind === 'refusal' && generation.reason.length).toBe(500);
  });

  it.each([
    ['neither SQL nor a reason', { sql: '', cannotAnswerReason: '' }],
    ['missing fields', {}],
    ['a non-string SQL', { sql: 42, cannotAnswerReason: '' }],
    ['an array', ['SELECT 1']],
    ['a string', 'SELECT 1'],
    ['null', null],
  ])('rejects %s', (_case, data) => {
    expectInvalid(() => parseSqlGeneration(data));
  });
});

describe('parseExplanation', () => {
  it('reads the explanation and a chart suggestion', () => {
    expect(
      parseExplanation(
        {
          explanation: 'O Sudeste lidera.',
          visualization: 'bar',
          xColumn: 'regiao',
          yColumn: 'faturamento',
        },
        COLUMNS,
      ),
    ).toEqual({
      explanation: 'O Sudeste lidera.',
      visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'faturamento' },
    });
  });

  it('keeps a table suggestion without columns', () => {
    expect(
      parseExplanation(
        { explanation: 'Ok.', visualization: 'table', xColumn: 'regiao', yColumn: 'faturamento' },
        COLUMNS,
      ).visualization,
    ).toEqual({ type: 'table' });
  });

  it.each([
    ['an unknown chart type', { visualization: 'pie', xColumn: 'regiao', yColumn: 'faturamento' }],
    [
      'a column that is not in the result',
      { visualization: 'bar', xColumn: 'pais', yColumn: 'faturamento' },
    ],
    ['a missing column', { visualization: 'line', xColumn: 'regiao', yColumn: '' }],
    [
      'the same column on both axes',
      { visualization: 'bar', xColumn: 'regiao', yColumn: 'regiao' },
    ],
    ['a missing visualization', {}],
    [
      'a script instead of a chart type',
      { visualization: '<script>alert(1)</script>', xColumn: 'regiao', yColumn: 'faturamento' },
    ],
  ])('falls back to a table for %s', (_case, fields) => {
    expect(parseExplanation({ explanation: 'Ok.', ...fields }, COLUMNS).visualization).toEqual({
      type: 'table',
    });
  });

  it('cuts an overlong explanation', () => {
    const parsed = parseExplanation(
      { explanation: 'x'.repeat(10_000), visualization: 'table' },
      COLUMNS,
    );

    expect(parsed.explanation).toHaveLength(2000);
  });

  it.each([
    ['an empty explanation', { explanation: '  ', visualization: 'table' }],
    ['a missing explanation', { visualization: 'table' }],
    ['a non-string explanation', { explanation: { text: 'x' }, visualization: 'table' }],
    ['null', null],
  ])('rejects %s', (_case, data) => {
    expectInvalid(() => parseExplanation(data, COLUMNS));
  });
});
