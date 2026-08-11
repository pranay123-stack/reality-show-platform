import type { Page } from '@playwright/test';

/** Seeded demo accounts. Created by `pnpm db:seed`, development only. */
export const ACCOUNTS = {
  viewer: 'viewer1@reality.local',
  producer: 'producer@reality.local',
  moderator: 'moderator@reality.local',
  admin: 'admin@reality.local',
} as const;

export const PASSWORD = process.env.E2E_PASSWORD ?? 'DemoPass!2026';

export const PUBLIC_ROUTES = ['/', '/login', '/signup', '/forgot-password'];

export const VIEWER_ROUTES = [
  '/dashboard',
  '/contestants',
  '/predictions',
  '/challenges',
  '/challenges/new',
  '/perspectives',
  '/polls',
  '/nominations',
  '/evictions',
  '/kitchen',
  '/kitchen/markets',
  '/weekend',
  '/rewards',
  '/my-rewards',
  '/leaderboard',
  '/notifications',
  '/profile',
];

export const ADMIN_ROUTES = [
  '/admin',
  '/admin/analytics',
  '/admin/audit',
  '/admin/challenges',
  '/admin/contestants',
  '/admin/kitchen',
  '/admin/leaderboard',
  '/admin/notifications',
  '/admin/polls',
  '/admin/predictions',
  '/admin/rewards',
  '/admin/weekend',
];

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.waitForSelector('#email');
  // Clicking before React hydrates submits the form natively and loses the
  // POST, which is a slow and confusing way to discover a hydration problem.
  await page.waitForTimeout(600);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 45_000 });
}

/** Waits for the page to be interactive, not merely painted. */
export async function settle(page: Page): Promise<void> {
  await page.waitForSelector('main, body');
  await page.waitForTimeout(1800);
}

export interface PageMeasurements {
  overflow: number;
  widest: { tag: string; className: string; right: number } | null;
  headings: number;
  smallTargets: string[];
  unlabelledControls: string[];
  landmarks: { main: number; nav: number };
}

/** WCAG 2.2 SC 2.5.8, Target Size (Minimum), level AA. */
const MIN_TARGET_PX = 24;

export function measure(page: Page): Promise<PageMeasurements> {
  return page.evaluate((minTarget) => {
    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;

    let widest: PageMeasurements['widest'] = null;
    if (overflow > 0) {
      for (const node of document.querySelectorAll('*')) {
        const box = node.getBoundingClientRect();
        if (box.right > root.clientWidth + 1 && (!widest || box.right > widest.right)) {
          widest = {
            tag: node.tagName,
            className: String(node.className).slice(0, 80),
            right: Math.round(box.right),
          };
        }
      }
    }

    const smallTargets: string[] = [];
    const unlabelledControls: string[] = [];

    for (const node of document.querySelectorAll('button, a[href], [role=button]')) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // The skip link is 1x1 until focused, which is the point of it.
      if (String(node.className).includes('skip-link')) continue;

      const name = (
        node.getAttribute('aria-label') ??
        node.getAttribute('title') ??
        node.textContent ??
        ''
      ).trim();
      if (!name) unlabelledControls.push(`${node.tagName}.${String(node.className).slice(0, 40)}`);

      // SC 2.5.8 exempts a target inside a sentence of running text.
      const inSentence = node.parentElement?.textContent?.trim() !== node.textContent?.trim();
      if (inSentence) continue;
      if (box.height < minTarget || box.width < minTarget) {
        smallTargets.push(`${Math.round(box.width)}x${Math.round(box.height)} "${name.slice(0, 24)}"`);
      }
    }

    return {
      overflow,
      widest,
      headings: document.querySelectorAll('h1').length,
      smallTargets,
      unlabelledControls,
      landmarks: {
        main: document.querySelectorAll('main').length,
        nav: document.querySelectorAll('nav').length,
      },
    };
  }, MIN_TARGET_PX);
}
