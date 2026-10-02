import type { QueryColumn } from '@interview-lab/shared';
import { describe, expect, it } from 'vitest';
import { LlmError } from '../llm/llm-error.js';
import { parseSqlGeneration, parseSummary, resolveVisualization } from './llm-output.js';

const COLUMNS: QueryColumn[] = [
  { name: 'regiao', type: 'text' },
  { name: 'faturamento', type: 'numeric' },
];

function expectInvalid(action: () => unknown): void {
  expect(action).toThrow(LlmError);
  expect(action).toThrow('O serviço de IA devolveu uma resposta que não pôde ser usada.');
}

describe('parseSqlGeneration', () => {
  it('reads the SQL and the proposed visualization', () => {
    expect(
      parseSqlGeneration({
        sql: ' SELECT 1 ',
        cannotAnswerReason: '',
        visualization: 'bar',
        xColumn: 'regiao',
        yColumn: 'faturamento',
      }),
    ).toEqual({
      kind: 'sql',
      sql: 'SELECT 1',
      visualization: { type: 'bar', xColumn: 'regiao', yColumn: 'faturamento' },
    });
  });

  it('reads the SQL even when the visualization fields are missing', () => {
    expect(parseSqlGeneration({ sql: 'SELECT 1' })).toEqual({
      kind: 'sql',
      sql: 'SELECT 1',
      visualization: { type: '', xColumn: '', yColumn: '' },
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

describe('resolveVisualization', () => {
  it('accepts a chart whose columns exist in the result', () => {
    expect(
      resolveVisualization({ type: 'bar', xColumn: 'regiao', yColumn: 'faturamento' }, COLUMNS),
    ).toEqual({ type: 'bar', xColumn: 'regiao', yColumn: 'faturamento' });
  });

  it('keeps a table suggestion without columns', () => {
    expect(
      resolveVisualization({ type: 'table', xColumn: 'regiao', yColumn: 'faturamento' }, COLUMNS),
    ).toEqual({ type: 'table' });
  });

  it.each([
    ['an unknown chart type', { type: 'pie', xColumn: 'regiao', yColumn: 'faturamento' }],
    [
      'a column that is not in the result',
      { type: 'bar', xColumn: 'pais', yColumn: 'faturamento' },
    ],
    ['a missing column', { type: 'line', xColumn: 'regiao', yColumn: '' }],
    ['the same column on both axes', { type: 'bar', xColumn: 'regiao', yColumn: 'regiao' }],
    ['an empty suggestion', { type: '', xColumn: '', yColumn: '' }],
    [
      'a script instead of a chart type',
      { type: '<script>alert(1)</script>', xColumn: 'regiao', yColumn: 'faturamento' },
    ],
  ])('falls back to a table for %s', (_case, proposed) => {
    expect(resolveVisualization(proposed, COLUMNS)).toEqual({ type: 'table' });
  });
});

describe('parseSummary', () => {
  it('reads the summary', () => {
    expect(parseSummary({ summary: ' O usuário analisou vendas. ' })).toBe(
      'O usuário analisou vendas.',
    );
  });

  it('cuts an overlong summary', () => {
    expect(parseSummary({ summary: 'x'.repeat(10_000) })).toHaveLength(2000);
  });

  it.each([
    ['an empty summary', { summary: ' ' }],
    ['a missing summary', {}],
    ['a non-string summary', { summary: ['x'] }],
    ['null', null],
  ])('rejects %s', (_case, data) => {
    expectInvalid(() => parseSummary(data));
  });
});
