import { describe, expect, it } from 'vitest';
import { InvalidEnvError, loadEnv } from './env.js';

describe('loadEnv', () => {
  it('uses the default port when PORT is not set', () => {
    expect(loadEnv({})).toEqual({ port: 3000 });
  });

  it('reads PORT from the environment', () => {
    expect(loadEnv({ PORT: '8080' })).toEqual({ port: 8080 });
  });

  it.each(['abc', '0', '70000', '80.5'])('rejects invalid PORT "%s"', (rawPort) => {
    expect(() => loadEnv({ PORT: rawPort })).toThrow(InvalidEnvError);
  });
});
