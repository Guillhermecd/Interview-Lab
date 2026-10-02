import { loadModule, parse } from 'libpg-query';
import { beforeAll, describe, expect, it } from 'vitest';

// Smoke test for D-04: proves the Postgres parser installs and runs on every
// platform the CI uses. The SQL guard rules themselves arrive in Phase 03.
describe('libpg-query installation', () => {
  beforeAll(async () => {
    await loadModule();
  });

  it('parses a SELECT into an AST with a single statement', async () => {
    const result = await parse('SELECT id FROM orders LIMIT 10');

    expect(result.stmts).toHaveLength(1);
    expect(result.stmts?.[0]?.stmt).toHaveProperty('SelectStmt');
  });

  it('sees every statement in a multi-statement input', async () => {
    const result = await parse('SELECT 1; DROP TABLE orders');

    expect(result.stmts).toHaveLength(2);
  });

  it('rejects input that Postgres would not accept', async () => {
    await expect(parse('SELEC 1')).rejects.toThrow();
  });
});
