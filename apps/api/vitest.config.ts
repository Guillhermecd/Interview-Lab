import { defineConfig } from 'vitest/config';

const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/**/*.integration.test.ts'],
          testTimeout: CONTAINER_STARTUP_TIMEOUT_MS,
          hookTimeout: CONTAINER_STARTUP_TIMEOUT_MS,
        },
      },
    ],
  },
});
