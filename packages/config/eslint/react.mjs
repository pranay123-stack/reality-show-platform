import globals from 'globals';

import { baseConfig } from './base.mjs';

/** Browser/React flat config (Next.js app, UI package). */
export const reactConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
  },
];

export default reactConfig;
