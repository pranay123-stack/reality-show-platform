import reactConfig from '@reality/config/eslint/react';

export default [
  ...reactConfig,
  { ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
  {
    // Standalone developer tooling: printing results is the whole point.
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];
