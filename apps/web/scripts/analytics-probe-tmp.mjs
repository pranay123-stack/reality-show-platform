import { chromium } from '@playwright/test';

const VIEWPORTS = [{ name: 'mobile', width: 390, height: 844 }];
const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function login(page, email) {
  await page.goto('http://localhost:3010/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email');
  // Give React time to hydrate; clicking before it does submits the form
  // natively and never reaches the client-side handler.
  await page.waitForTimeout(1500);
  await page.fill('#email', email);
  await page.fill('#password', 'DemoPass!2026');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}
const overflow = (p) =>
  p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let worst = 0;
for (const viewport of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 90)));
  await login(p, 'admin@reality.local');
  await p.goto('http://localhost:3010/admin/analytics', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('main');
  await p.waitForTimeout(2200);

  const o = await overflow(p);
  worst = Math.max(worst, o);
  const h1 = await p.locator('h1').first().innerText().catch(() => '(none)');
  const cards = await p.locator('main ul li').count();
  const funnel = await p.locator('text=Engagement funnel').count();
  const features = await p.locator('text=Feature adoption').count();
  console.log(`${viewport.name.padEnd(8)} overflow=${o}px h1="${h1}" cards=${cards} funnel=${funnel} features=${features} errors=${errors.length}`);
  if (errors.length) console.log('   ', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// The viewer's own privacy control.
const ctx = await browser.newContext({ viewport: VIEWPORTS[0] });
const page = await ctx.newPage();
await login(page, 'viewer1@reality.local');
await page.goto('http://localhost:3010/profile', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('main');
await page.waitForTimeout(1800);
const toggle = page.locator('button', { hasText: /Turn analytics (on|off)/ }).first();
console.log(`\nprivacy control present: ${(await toggle.count()) > 0}`);
if (await toggle.count()) {
  const before = await toggle.innerText();
  await toggle.click();
  await page.waitForTimeout(2200);
  console.log(`  "${before.trim()}" -> "${(await toggle.innerText()).trim()}"`);
  console.log(`  toast: ${(await page.locator('[data-sonner-toast]').first().innerText().catch(() => '')).replace(/\n/g, ' ')}`);
  await toggle.click();
  await page.waitForTimeout(1500);
}

// A viewer must not reach the dashboard.
await page.goto('http://localhost:3010/admin/analytics', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('main');
await page.waitForTimeout(1500);
console.log(`viewer on /admin/analytics refused: ${(await page.locator('text=No console access').count()) > 0}`);

console.log(`\nworst overflow: ${worst}px`);
await browser.close();
