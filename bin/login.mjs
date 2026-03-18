#!/usr/bin/env node
/**
 * bin/login.mjs — One-time manual login helper for emergent-mcp
 *
 * Usage:
 *   npx emergent-mcp-login
 *   # or:
 *   node bin/login.mjs
 *
 * Opens a visible browser window pointing at https://app.emergent.sh/landing/
 * You log in manually (supports Google OAuth, email, SSO — bypasses CAPTCHA).
 * The session is saved to ~/.emergent-mcp/session/storage-state.json
 * All subsequent `emergent-mcp` runs will use this saved session headlessly.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as readline from 'readline';

const SESSION_DIR = process.env.EMERGENT_SESSION_DIR
  ?? join(homedir(), '.emergent-mcp', 'session');
const storageStatePath = join(SESSION_DIR, 'storage-state.json');

console.log('=== emergent-mcp login ===\n');
console.log('Opening browser window...');
console.log('Please log in to Emergent.sh in the browser window that appears.');
console.log('Supports: Google OAuth, email/password, SSO — any method works.\n');

const browser = await chromium.launch({
  headless: false,
  args: ['--start-maximized'],
});

const ctx = await browser.newContext({
  viewport: null, // use window size in non-headless
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
});

const page = await ctx.newPage();
await page.goto('https://app.emergent.sh/landing/', { waitUntil: 'domcontentloaded' });

// Check if already logged in
const alreadyLoggedIn = !page.url().includes('/landing');
if (alreadyLoggedIn) {
  console.log('Already logged in! Session is valid.');
  await saveAndExit(ctx, browser);
  process.exit(0);
}

// Wait for login
console.log('Waiting for login (up to 3 minutes)...\n');

try {
  await page.waitForURL(
    (url) => !url.href.includes('/landing') && !url.href.includes('/login') && !url.href.includes('/signin'),
    { timeout: 180_000 }
  );
  console.log('\n✅ Login successful! Saving session...');
  await saveAndExit(ctx, browser);
  console.log(`Session saved to: ${storageStatePath}`);
  console.log('\nYou can now run emergent-mcp headlessly:');
  console.log('  npx @openclaw/emergent-mcp');
  process.exit(0);
} catch (e) {
  console.error('\n❌ Timed out waiting for login. Please try again.');
  await browser.close();
  process.exit(1);
}

async function saveAndExit(ctx, browser) {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  await ctx.storageState({ path: storageStatePath });
  await browser.close();
}
