/**
 * diagnose.mjs — Validate the emergent-mcp session and scrape live UI state
 *
 * Run: node diagnose.mjs
 *
 * Checks if a saved session exists and is valid, screenshots the dashboard,
 * and dumps key DOM info (buttons, project links, textareas) so you can
 * verify and update selectors in src/tools/*.js.
 *
 * Output: /tmp/emergent-diag/
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SESSION_DIR = join(homedir(), '.emergent-mcp', 'session');
const storageStatePath = join(SESSION_DIR, 'storage-state.json');
const OUT_DIR = '/tmp/emergent-diag';

mkdirSync(OUT_DIR, { recursive: true });

const hasSession = existsSync(storageStatePath);
console.log(`Session file: ${hasSession ? '✅ found' : '❌ not found'} (${storageStatePath})`);

if (!hasSession) {
  console.log('\n⚠️  No saved session. Run `npx emergent-mcp-login` first to log in manually.');
  console.log('   The login helper opens a browser window — CAPTCHA must be solved by a human.');
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  storageState: storageStatePath,
});
const page = await ctx.newPage();

console.log('\nNavigating to https://app.emergent.sh ...');
await page.goto('https://app.emergent.sh', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const url = page.url();
const loggedIn = !url.includes('/landing') && !url.includes('/login');
console.log(`URL: ${url}`);
console.log(`Login status: ${loggedIn ? '✅ logged in' : '❌ session expired — re-run emergent-mcp-login'}`);

await page.screenshot({ path: `${OUT_DIR}/dashboard.png`, fullPage: true });
console.log(`Screenshot saved: ${OUT_DIR}/dashboard.png`);

const info = await page.evaluate(() => {
  const textareas = [...document.querySelectorAll('textarea')].map(el => ({
    placeholder: el.placeholder,
    visible: el.offsetParent !== null,
    name: el.name,
  }));
  const buttons = [...document.querySelectorAll('button')]
    .filter(b => b.offsetParent)
    .map(b => b.textContent?.trim().slice(0, 50))
    .filter(Boolean);
  const projectLinks = [...document.querySelectorAll('a[href*="/project"]')].map(a => ({
    href: a.href,
    text: a.textContent?.trim().slice(0, 60),
  }));
  const headings = [...document.querySelectorAll('h1,h2,h3')].map(el => el.textContent?.trim().slice(0, 80));
  return { url: location.href, textareas, buttons, projectLinks, headings };
});

writeFileSync(`${OUT_DIR}/dashboard.json`, JSON.stringify(info, null, 2));

console.log('\n--- Dashboard DOM ---');
console.log('Headings:', info.headings);
console.log('Visible buttons:', info.buttons);
console.log('Textareas:', info.textareas);
console.log(`Project links found: ${info.projectLinks.length}`);
info.projectLinks.forEach(p => console.log(' -', p.href, '|', p.text));

await browser.close();
console.log(`\nFull DOM dump: ${OUT_DIR}/dashboard.json`);
