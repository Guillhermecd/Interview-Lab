import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../config/env.js';
import { CatalogModule } from './catalog.module.js';
import { CATALOG_POOL } from './catalog-pool.js';

const ENV = {
  catalogDatabase: {
    host: 'localhost',
    port: 5432,
    name: 'interview_lab',
    catalogPassword: 'catalog-secret',
    poolMax: 1,
  },
} as AppEnv;

// The security boundary of the registry (D-56): its pool is the only way to
// write to `sales`, so nothing of this module may be reachable from another.
describe('CatalogModule', () => {
  it('exports nothing', () => {
    expect(CatalogModule.register(ENV).exports).toEqual([]);
  });

  it('is not global', () => {
    expect(CatalogModule.register(ENV).global).toBeUndefined();
  });

  it('provides the write pool only to itself', () => {
    const module = CatalogModule.register(ENV);
    const tokens = (module.providers ?? []).map((provider) =>
      typeof provider === 'function' ? provider : provider.provide,
    );

    expect(tokens).toContain(CATALOG_POOL);
    expect(module.exports).not.toContain(CATALOG_POOL);
  });
});
