import { expect, test } from '@playwright/test';

import {
  ACCOUNTS,
  ADMIN_ROUTES,
  PUBLIC_ROUTES,
  VIEWER_ROUTES,
  measure,
  settle,
  signIn,
} from './helpers';

/**
 * Every route, at every breakpoint, in a production build.
 *
 * The Playwright project decides the viewport, so each of these runs three
 * times — 1440, 834 and 390 — without the file knowing about it.
 */

/** Errors a browser reports that say nothing about this application. */
function isOurProblem(text: string): boolean {
  if (/favicon|net::ERR_|ResizeObserver loop/i.test(text)) return false;
  // A signed-out visitor asking "who am I" is answered with 401 by design.
  if (/401|Unauthorized/i.test(text)) return false;
  return true;
}

test.describe('public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders, hydrates and fits the viewport`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error' && isOurProblem(message.text())) errors.push(message.text());
      });

      await page.goto(route);
      await settle(page);

      const result = await measure(page);

      expect(result.overflow, `${route} overflows: ${JSON.stringify(result.widest)}`).toBe(0);
      expect(result.headings, `${route} should own exactly one h1`).toBe(1);
      expect(result.smallTargets, `${route} has targets under 24px`).toEqual([]);
      expect(result.unlabelledControls, `${route} has unnamed controls`).toEqual([]);
      expect(errors, `${route} logged errors`).toEqual([]);
    });
  }
});

test.describe('signed-in routes', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
  });

  for (const route of VIEWER_ROUTES) {
    test(`${route} renders, hydrates and fits the viewport`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error' && isOurProblem(message.text())) errors.push(message.text());
      });

      await page.goto(route);
      await settle(page);

      const result = await measure(page);

      expect(result.overflow, `${route} overflows: ${JSON.stringify(result.widest)}`).toBe(0);
      expect(result.headings, `${route} should own exactly one h1`).toBe(1);
      expect(result.landmarks.main, `${route} needs a main landmark`).toBeGreaterThan(0);
      expect(result.smallTargets, `${route} has targets under 24px`).toEqual([]);
      expect(errors, `${route} logged errors`).toEqual([]);
    });
  }
});

test.describe('operator console', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
  });

  for (const route of ADMIN_ROUTES) {
    test(`${route} renders, hydrates and fits the viewport`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error' && isOurProblem(message.text())) errors.push(message.text());
      });

      await page.goto(route);
      await settle(page);

      const result = await measure(page);

      expect(result.overflow, `${route} overflows: ${JSON.stringify(result.widest)}`).toBe(0);
      expect(result.headings, `${route} should own exactly one h1`).toBe(1);
      expect(errors, `${route} logged errors`).toEqual([]);
    });
  }
});

test.describe('hydration', () => {
  test('the page is interactive, not just painted', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/leaderboard');
    await settle(page);

    // A dead shell renders the chips and ignores the click. Driving one and
    // watching the pressed state move is what distinguishes the two.
    const group = page.getByRole('group', { name: /time period/i });
    await expect(group).toBeVisible();

    const target = group.getByRole('button').nth(1);
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
  });

  test('client-side navigation works without a full reload', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/dashboard');
    await settle(page);

    await page.evaluate(() => {
      (window as unknown as { __stillHere: boolean }).__stillHere = true;
    });

    await page.getByRole('link', { name: /contestants/i }).first().click();
    await page.waitForURL('**/contestants');

    // A router navigation keeps the JavaScript context; a full reload loses it.
    expect(await page.evaluate(() => (window as unknown as { __stillHere?: boolean }).__stillHere)).toBe(
      true,
    );
  });
});

test.describe('accessibility basics', () => {
  test('the skip link is the first stop and reaches the content', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/dashboard');
    await settle(page);

    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    await expect(focused).toHaveText(/skip to content/i);
    // Hidden until focused, and a real target once it is.
    const box = await focused.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

    await page.keyboard.press('Enter');
    expect(page.url()).toContain('#main');
  });

  test('every page keeps a visible focus ring', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/rewards');
    await settle(page);

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement!);
      return { width: style.outlineWidth, style: style.outlineStyle, shadow: style.boxShadow };
    });

    // Either an outline or a ring shadow — the design system uses both.
    const hasRing =
      (outline.style !== 'none' && outline.width !== '0px') || outline.shadow !== 'none';
    expect(hasRing).toBe(true);
  });

  test('a signed-out visitor is sent to sign in rather than shown an empty shell', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/login**');

    expect(page.url()).toContain('/login');
    expect(page.url()).toContain('next=');
  });
});
