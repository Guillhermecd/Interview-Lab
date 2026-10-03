import { describe, expect, it } from 'vitest';
import { normalizeQuestion } from './answer-cache.js';
import { schemaVersion } from '../query/schema-catalog.service.js';

describe('normalizeQuestion', () => {
  it.each([
    'Qual o faturamento por região?',
    'qual o faturamento por região',
    '  Qual   o faturamento\npor região ?! ',
    'QUAL O FATURAMENTO POR REGIÃO.',
  ])('treats "%s" as the same question', (question) => {
    expect(normalizeQuestion(question)).toBe('qual o faturamento por região');
  });

  it('keeps questions with different words apart', () => {
    expect(normalizeQuestion('faturamento por região')).not.toBe(
      normalizeQuestion('faturamento por produto'),
    );
  });
});

describe('schemaVersion', () => {
  const table = {
    name: 'orders',
    columns: [{ name: 'id', type: 'bigint', nullable: false }],
    constraints: [],
  };

  it('is stable for the same schema', () => {
    expect(schemaVersion([table])).toBe(schemaVersion([{ ...table }]));
  });

  it('changes when a column is added', () => {
    const changed = {
      ...table,
      columns: [...table.columns, { name: 'note', type: 'text', nullable: true }],
    };

    expect(schemaVersion([changed])).not.toBe(schemaVersion([table]));
  });
});
