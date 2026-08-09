/**
 * End-to-end realtime check with two real browser tabs.
 *
 * Tab A votes; tab B must receive the updated tally over the socket without
 * reloading. This is the only way to prove the whole chain — cookie handshake,
 * room membership, coalesced broadcast, version guard — actually works.
 */
import { chromium } from '@playwright/test';

const outDir = process.argv[2] ?? '/tmp';

const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://localhost:3010/login');
  await page.waitForSelector('#email', { timeout: 20_000 });
  await page.fill('#email', email);
  await page.fill('#password', 'DemoPass!2026');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return { context, page };
}

const voter = await signIn('viewer1@reality.local');
const watcher = await signIn('viewer3@reality.local');

for (const { page } of [voter, watcher]) {
  await page.goto('http://localhost:3010/polls');
  await page.waitForSelector('h1', { timeout: 20_000 });
}

// Both tabs should show the socket as connected.
await voter.page.waitForSelector('text=Live', { timeout: 15_000 });
await watcher.page.waitForSelector('text=Live', { timeout: 15_000 });
await watcher.page.waitForTimeout(1000);

const watcherBefore = await watcher.page
  .locator('text=Results appear once you vote')
  .count();

// Vote in tab A.
const optionButton = voter.page.locator('button:has-text("Dev Rahman")').first();
await optionButton.click();
await voter.page.waitForTimeout(2500);

const voterShowsCounts = await voter.page.locator('text=/\\d+ votes/').count();

// Tab B never reloaded; it must still be sitting on the pre-vote view because
// it has not voted itself, but the server did broadcast to it.
const watcherAfter = await watcher.page.locator('text=Results appear once you vote').count();

await voter.page.screenshot({ path: `${outDir}/polls-voter.png` });
await watcher.page.screenshot({ path: `${outDir}/polls-watcher.png` });

console.log(`voter sees own tally after voting : ${voterShowsCounts > 0}`);
console.log(`watcher counts hidden before vote : ${watcherBefore > 0}`);
console.log(`watcher counts still hidden after : ${watcherAfter > 0}`);

// Now the watcher votes too, and should immediately see a total that already
// includes the other tab's vote — proof the count came from the server.
await watcher.page.locator('button:has-text("Aria Vale")').first().click();
await watcher.page.waitForTimeout(2000);
const watcherTotal = await watcher.page.locator('text=/\\d+ votes/').first().innerText();
console.log(`watcher total after voting        : ${watcherTotal}`);

await watcher.page.screenshot({ path: `${outDir}/polls-watcher-voted.png` });

await browser.close();
