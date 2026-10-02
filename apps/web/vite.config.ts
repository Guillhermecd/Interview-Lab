import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_DEV_URL = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': API_DEV_URL },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
