/**
 * Headless UI verification helper.
 *
 * Not part of the test suite — it is the script used to confirm, with real
 * screenshots and real measurements, that a screen renders correctly at each
 * breakpoint. Run it against a started stack:
 *
 *   node scripts/verify-ui.mjs <outputDir> [path] [--auth]
 */
import { chromium } from '@playwright/test';

const [outDir = '/tmp', targetPath = '/dashboard', ...flags] = process.argv.slice(2);
const needsAuth = flags.includes('--auth') || targetPath !== '/';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 140)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 140));
  });

  if (needsAuth) {
    await page.goto('http://localhost:3010/login');
    await page.waitForSelector('#email', { timeout: 20_000 });
    await page.fill('#email', 'viewer1@reality.local');
    await page.fill('#password', 'DemoPass!2026');
    await page.click('button[type=submit]');
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
  }

  if (targetPath !== '/dashboard') {
    await page.goto(`http://localhost:3010${targetPath}`);
  }

  await page.waitForSelector('main', { timeout: 20_000 });
  await page.waitForTimeout(1200);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const h1 = await page
    .locator('h1')
    .first()
    .innerText()
    .catch(() => '(none)');
  const sidebar = await page
    .locator('aside')
    .isVisible()
    .catch(() => false);
  const bottomNav = await page
    .locator('nav[aria-label="Primary"]')
    .isVisible()
    .catch(() => false);
  const timers = await page.locator('[role="timer"]').count();

  const slug = targetPath.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'root';
  await page.screenshot({ path: `${outDir}/${slug}-${viewport.name}.png` });

  console.log(
    `${viewport.name.padEnd(8)} overflow=${overflow}px sidebar=${sidebar} bottomNav=${bottomNav} timers=${timers} errors=${errors.length} h1="${h1.replace(/\n/g, ' ')}"`,
  );
  if (errors.length > 0) console.log('        ', errors.slice(0, 3).join(' | '));

  await context.close();
}

await browser.close();
