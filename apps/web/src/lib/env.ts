/**
 * Client-visible configuration.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time by Next, so they must be read
 * as whole property accesses (not `process.env[key]`).
 */
export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000',
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Reality Platform',
} as const;
