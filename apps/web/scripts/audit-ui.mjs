/**
 * Whole-application UI audit.
 *
 * `verify-ui.mjs` looks hard at one screen and writes screenshots. This looks
 * shallowly at every screen and writes numbers, which is the check that catches
 * a regression somewhere nobody was thinking about. Run it against a started
 * stack — preferably a production one, since `next dev` and `next build` do not
 * serve the same document:
 *
 *   pnpm build && pnpm start
 *   node scripts/audit-ui.mjs
 *
 * It reports, per page and per breakpoint:
 *   - horizontal overflow in pixels, and the widest offending element
 *   - the number of `h1` elements (exactly one is correct)
 *   - interactive targets under 24 px, WCAG 2.2 SC 2.5.8's minimum
 *   - uncaught JavaScript errors
 *
 * Do not run this at the same time as `pnpm test`: the API suite truncates the
 * database the demo accounts live in, and every login here will fail.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.AUDIT_BASE_URL ?? 'http://localhost:3010';
const PASSWORD = process.env.AUDIT_PASSWORD ?? 'DemoPass!2026';

/** WCAG 2.2 SC 2.5.8, Target Size (Minimum), level AA. */
const MIN_TARGET_PX = 24;

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '834', width: 834, height: 1112 },
  { name: '390', width: 390, height: 844 },
];

const PUBLIC = ['/', '/login', '/signup', '/forgot-password'];

const VIEWER = [
  '/dashboard', '/contestants', '/predictions', '/challenges', '/challenges/new',
  '/perspectives', '/polls', '/nominations', '/evictions', '/kitchen', '/weekend',
  '/rewards', '/my-rewards', '/leaderboard', '/notifications', '/profile',
];

const ADMIN = [
  '/admin', '/admin/analytics', '/admin/audit', '/admin/challenges', '/admin/contestants',
  '/admin/kitchen', '/admin/leaderboard', '/admin/notifications', '/admin/polls',
  '/admin/predictions', '/admin/rewards', '/admin/weekend',
];

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 30_000 });
  // Clicking before React hydrates submits the form natively and loses the POST.
  await page.waitForTimeout(700);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
}

async function measure(page, path) {
  const errors = [];
  const onError = (error) => errors.push(String(error).slice(0, 100));
  page.on('pageerror', onError);

  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('main, body', { timeout: 20_000 });
  // Long enough for data to arrive and the page to settle into its real height.
  await page.waitForTimeout(2500);

  const result = await page.evaluate((minTarget) => {
    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;

    // Naming the widest offender turns "something overflows" into a fix.
    let worst = null;
    if (overflow > 0) {
      for (const node of document.querySelectorAll('*')) {
        const box = node.getBoundingClientRect();
        if (box.right > root.clientWidth + 1 && (!worst || box.right > worst.right)) {
          worst = {
            right: Math.round(box.right),
            tag: node.tagName,
            cls: String(node.className).slice(0, 60),
          };
        }
      }
    }

    const small = [];
    for (const node of document.querySelectorAll('button, a[href], [role=button]')) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // The skip link is 1x1 until focused, which is what it is for.
      if (String(node.className).includes('skip-link')) continue;
      // SC 2.5.8 exempts a target sitting inside a sentence.
      const inSentence = node.parentElement?.textContent?.trim() !== node.textContent?.trim();
      if (inSentence) continue;
      if (box.height < minTarget || box.width < minTarget) {
        small.push(
          `${Math.round(box.width)}x${Math.round(box.height)} "${(node.textContent || '').trim().slice(0, 24)}"`,
        );
      }
    }

    return { overflow, worst, h1: document.querySelectorAll('h1').length, small };
  }, MIN_TARGET_PX);

  page.off('pageerror', onError);
  return { ...result, errors };
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const rows = [];

for (const viewport of VIEWPORTS) {
  const size = { width: viewport.width, height: viewport.height };

  const anon = await browser.newContext({ viewport: size });
  const anonPage = await anon.newPage();
  for (const path of PUBLIC) {
    rows.push({ viewport: viewport.name, path, ...(await measure(anonPage, path)) });
  }
  await login(anonPage, 'viewer1@reality.local');
  for (const path of VIEWER) {
    rows.push({ viewport: viewport.name, path, ...(await measure(anonPage, path)) });
  }
  await anon.close();

  // A separate context, because the console needs a different account.
  const operator = await browser.newContext({ viewport: size });
  const operatorPage = await operator.newPage();
  await login(operatorPage, 'admin@reality.local');
  for (const path of ADMIN) {
    rows.push({ viewport: viewport.name, path, ...(await measure(operatorPage, path)) });
  }
  await operator.close();
}

await browser.close();

const overflowing = rows.filter((row) => row.overflow > 0);
const badHeading = rows.filter((row) => row.h1 !== 1);
const smallTargets = rows.filter((row) => row.small.length > 0);
const broken = rows.filter((row) => row.errors.length > 0);

console.log(`\nmeasured ${rows.length} page/viewport combinations`);
console.log(`max horizontal overflow   ${Math.max(...rows.map((row) => row.overflow))}px`);
console.log(`pages not owning one h1   ${badHeading.length}`);
console.log(`pages with targets <${MIN_TARGET_PX}px  ${smallTargets.length}`);
console.log(`pages with JS errors      ${broken.length}`);

for (const row of [...overflowing, ...badHeading, ...smallTargets, ...broken]) {
  const flags = [];
  if (row.overflow > 0) {
    flags.push(`overflow ${row.overflow}px${row.worst ? ` [${row.worst.tag}.${row.worst.cls}]` : ''}`);
  }
  if (row.h1 !== 1) flags.push(`h1=${row.h1}`);
  if (row.small.length) flags.push(`small: ${row.small.join(', ')}`);
  if (row.errors.length) flags.push(`error: ${row.errors[0]}`);
  console.log(`  ${row.viewport.padStart(4)}  ${row.path.padEnd(22)} ${flags.join(' · ')}`);
}

const failed = overflowing.length + badHeading.length + smallTargets.length + broken.length;
if (failed > 0) process.exitCode = 1;
else console.log('\nclean at every breakpoint');
