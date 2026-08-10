import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.tsx'],
  },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
