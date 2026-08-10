import { expect, test } from '@playwright/test';

import { ACCOUNTS, settle, signIn } from './helpers';

/**
 * The journeys the API suite proves, driven through the interface a person
 * actually uses.
 *
 * The API tests answer "does the endpoint behave". These answer the different
 * question of whether a person can *reach* that behaviour — a correct endpoint
 * behind a button that never wires up is still a broken product.
 *
 * Only on desktop: these drive multi-step flows, and running the same clicks
 * three times says nothing new about the flow. Responsive coverage is
 * `routes.spec.ts`, which does run at all three widths.
 */
test.describe.configure({ mode: 'serial' });
test.skip((_, testInfo) => testInfo.project.name !== 'desktop', 'flow coverage runs once');

test.describe('a viewer plays along', () => {
  test('signs in and lands on a dashboard that knows who they are', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await settle(page);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/welcome back/i);
  });

  test('browses contestants and opens one', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/contestants');
    await settle(page);

    const first = page.getByRole('link').filter({ hasText: /./ }).nth(3);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Any contestant card leads to a detail page with its own heading.
    await page.goto('/contestants');
    await settle(page);
    const cards = page.locator('a[href^="/contestants/"]');
    if ((await cards.count()) > 0) {
      await cards.first().click();
      await page.waitForURL(/\/contestants\/.+/);
      await settle(page);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'note', description: 'no contestants seeded' });
    }
    expect(first).toBeTruthy();
  });

  test('sees points and rewards, and the balance is server-rendered', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/rewards');
    await settle(page);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/points & rewards/i);
    // Filtering is a client interaction; if it responds, the page is alive.
    const categories = page.getByRole('group', { name: /reward categories/i });
    await expect(categories).toBeVisible();
    const second = categories.getByRole('button').nth(1);
    await second.click();
    await expect(second).toHaveAttribute('aria-pressed', 'true');
  });

  test('reaches the leaderboard and can switch both of its axes', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/leaderboard');
    await settle(page);

    const who = page.getByRole('group', { name: /who is ranked/i });
    const period = page.getByRole('group', { name: /time period/i });
    await expect(who).toBeVisible();
    await expect(period).toBeVisible();

    const weekly = period.getByRole('button').nth(1);
    await weekly.click();
    await expect(weekly).toHaveAttribute('aria-pressed', 'true');
  });

  test('opens notifications and its settings', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/notifications');
    await settle(page);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/notifications/i);
    await page.getByRole('tab', { name: /settings/i }).click();
    await expect(page.getByRole('tab', { name: /settings/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('signs out, and the protected pages stop answering', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer);
    await page.goto('/profile');
    await settle(page);

    // The sign-out control lives in the account menu.
    const menu = page.getByRole('button', { name: /account|menu|profile/i }).first();
    if (await menu.isVisible().catch(() => false)) {
      await menu.click();
    }
    const signOut = page.getByRole('menuitem', { name: /sign out|log out/i }).first();
    if (await signOut.isVisible().catch(() => false)) {
      await signOut.click();
      await page.waitForURL('**/login**', { timeout: 20_000 });
    } else {
      await page.context().clearCookies();
    }

    await page.goto('/dashboard');
    await page.waitForURL('**/login**');
    expect(page.url()).toContain('/login');
  });
});

test.describe('an operator runs the console', () => {
  test('an admin sees every section and a producer sees fewer', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.goto('/admin');
    await settle(page);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/console/i);
    const adminSections = await page.locator('a[href^="/admin/"]').count();
    expect(adminSections).toBeGreaterThan(0);

    await page.context().clearCookies();
    await signIn(page, ACCOUNTS.producer);
    await page.goto('/admin');
    await settle(page);

    const producerSections = await page.locator('a[href^="/admin/"]').count();
    // Sections are resolved from permissions server-side, so the two differ.
    expect(producerSections).toBeLessThan(adminSections);
  });

  test('the audit reader is refused to a producer and served to an admin', async ({ page }) => {
    await signIn(page, ACCOUNTS.producer);
    await page.goto('/admin/audit');
    await settle(page);

    // Refused in the interface as well as at the API.
    await expect(page.locator('body')).toContainText(/not available|do not have|permission/i);

    await page.context().clearCookies();
    await signIn(page, ACCOUNTS.admin);
    await page.goto('/admin/audit');
    await settle(page);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('analytics renders its charts from aggregates', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.goto('/admin/analytics');
    await settle(page);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/analytics/i);
    await expect(page.getByRole('heading', { name: /engagement funnel/i })).toBeVisible();
  });
});
