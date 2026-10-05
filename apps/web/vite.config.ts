import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_DEV_URL = 'http://localhost:3000';

// Libraries used only by screens loaded on demand. The dev server finds them
// when a screen is first opened and, without this list, stops to bundle them
// and reloads the page in the middle of whatever the user (or an end-to-end
// test) was doing. Listed here, they are bundled before the server answers.
const LAZY_SCREEN_DEPENDENCIES = [
  'react-router-dom',
  'recharts',
  '@codemirror/lang-sql',
  '@codemirror/language',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/highlight',
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { include: LAZY_SCREEN_DEPENDENCIES },
  server: {
    proxy: { '/api': API_DEV_URL },
    // Transforms the screens as soon as the server starts, not at first visit.
    warmup: { clientFiles: ['./src/main.tsx', './src/pages/*/index.ts'] },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
