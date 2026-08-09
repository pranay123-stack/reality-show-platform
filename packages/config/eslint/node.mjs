import globals from 'globals';

import { baseConfig } from './base.mjs';

/** Node/server flat config (Fastify API, scripts, seeds). */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  {
    files: ['**/*.test.ts', '**/tests/**/*.ts', '**/__tests__/**/*.ts', '**/prisma/seed*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default nodeConfig;
