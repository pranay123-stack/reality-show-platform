import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

// The monorepo keeps one .env at the root; Next only auto-loads from the app
// directory, so we read the root file here and forward the public values.
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source and are compiled by Next.
  transpilePackages: ['@reality/ui', '@reality/shared'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000',
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? 'Reality Platform',
  },
  async headers() {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const ws = process.env.NEXT_PUBLIC_WS_URL ?? api;
    const isDev = process.env.NODE_ENV !== 'production';

    /**
     * Content Security Policy.
     *
     * Defence in depth rather than the primary defence: React escapes what it
     * renders and no component uses `dangerouslySetInnerHTML`, so this is what
     * catches the mistake somebody makes later.
     *
     * `script-src` must allow inline scripts, and that is not a slip. The App
     * Router bootstraps every page with inline `<script>` tags carrying the
     * flight payload. Phase 18 removed `'unsafe-inline'` here and, because the
     * policy was only ever exercised against `next dev` — which keeps it for
     * React Refresh — nobody saw that the production build stopped hydrating
     * entirely: every page served a dead shell with no interactivity at all.
     *
     * The strict alternative is a per-request nonce, which cannot work here:
     * a nonce has to be unique per response, and 30 of these routes are
     * statically prerendered to HTML at build time. Nonces would mean giving up
     * static rendering for the whole app, which is a far larger decision than a
     * header. So `'unsafe-inline'` stays and the directives that close the usual
     * bypasses — `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
     * and no `'unsafe-eval'` in production — do the work instead.
     */
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      // Unavoidable for styles: Tailwind and Radix both inject at runtime.
      "style-src 'self' 'unsafe-inline'",
      // Avatars and media are operator-supplied http(s) URLs from anywhere.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self' ${api} ${ws} ${ws.replace(/^http/, 'ws')}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
