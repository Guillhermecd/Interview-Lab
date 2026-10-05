import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const BASE_URL = `http://localhost:${String(PORT)}`;

// End-to-end tests of the web app with the backend simulated by intercepting
// /api requests in the browser (D-31). No API or database is started.
//
// The app under test is the production build, served by `vite preview`: it is
// what ships, and it answers at once. The dev server compiles each screen at
// its first visit, which on a cold start took longer than a test waits.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
