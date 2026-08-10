import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests.
 *
 * Deliberately pointed at a **production** build rather than `next dev`, and
 * that is not a detail. Phase 20 found the entire production build serving dead
 * shells — React never hydrated, because a Content-Security-Policy that dev
 * relaxes for React Refresh blocked the App Router's inline bootstrap. Every
 * unit test, integration test, typecheck and lint passed throughout. Only a
 * real browser against a real build could see it.
 *
 * These do not start the stack, because they need Postgres, Redis, the API and
 * the web server together and failing on a missing database with a Playwright
 * timeout helps nobody. Bring it up first:
 *
 *   pnpm dev:infra && pnpm db:seed
 *   pnpm build && pnpm start
 *   pnpm test:e2e
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3010';

export default defineConfig({
  testDir: './e2e',
  // One journey at a time: these share a seeded database and a real session.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A production build still compiles nothing on demand, but the API behind
    // it is doing real work on first request.
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
});
