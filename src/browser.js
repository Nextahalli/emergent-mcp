/**
 * browser.js — Playwright session manager for Emergent.sh
 *
 * Maintains a persistent browser context (cookies + localStorage) so the agent
 * doesn't need to re-authenticate on every tool call. Session data is stored in
 * ~/.emergent-mcp/session/ by default, overridable via EMERGENT_SESSION_DIR.
 *
 * IMPORTANT: Emergent.sh uses Cloudflare Turnstile CAPTCHA on the login form,
 * which prevents headless automation of the login step. You MUST log in once
 * manually using a headful browser:
 *
 *   npx emergent-mcp-login
 *   # or:
 *   EMERGENT_HEADLESS=false node src/index.js
 *
 * After logging in once, the session is saved and all subsequent runs work
 * headlessly without re-authentication.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as readline from 'readline';

const EMERGENT_BASE_URL = 'https://app.emergent.sh';
const DEFAULT_TIMEOUT = 30_000;

// Where we persist auth cookies/storage
const SESSION_DIR = process.env.EMERGENT_SESSION_DIR
  ?? join(homedir(), '.emergent-mcp', 'session');

const storageStatePath = join(SESSION_DIR, 'storage-state.json');

// Singleton state
let _browser = null;
let _context = null;

/**
 * Returns a ready-to-use Playwright BrowserContext, reusing the singleton
 * if already open, restoring a saved session if one exists.
 */
export async function getContext() {
  if (_context) return _context;

  const headless = process.env.EMERGENT_HEADLESS !== 'false';

  _browser = await chromium.launch({ headless });

  const ctxOptions = {
    viewport: { width: 1400, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
  };

  _context = await _browser.newContext(ctxOptions);

  // Auto-save session after every navigation
  _context.on('page', (page) => {
    page.on('load', () => saveSession(_context).catch(() => {}));
  });

  return _context;
}

/**
 * Opens a page to Emergent and ensures the user is logged in.
 * Returns the page object.
 */
export async function getAuthenticatedPage() {
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  await page.goto(EMERGENT_BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const isLoggedIn = await checkLoggedIn(page);
  if (!isLoggedIn) {
    await performLogin(page);
  }

  return page;
}

/**
 * Checks whether the current page state is authenticated.
 * Emergent redirects unauthenticated users to /landing/ — that's the reliable signal.
 */
async function checkLoggedIn(page) {
  const url = page.url();
  return !url.includes('/landing') && !url.includes('/login') && !url.includes('/signin');
}

/**
 * Handles login. In headless mode this throws with clear instructions.
 * In headful mode (EMERGENT_HEADLESS=false), waits for manual login then saves session.
 */
async function performLogin(page) {
  const headless = process.env.EMERGENT_HEADLESS !== 'false';

  if (headless) {
    throw new Error(
      'Not logged in to Emergent.sh. Emergent uses Cloudflare Turnstile CAPTCHA which ' +
      'prevents automated headless login.\n\n' +
      'Please log in once manually:\n' +
      '  npx emergent-mcp-login\n\n' +
      'This opens a browser window for manual login and saves your session for future headless use.\n' +
      `Session will be stored at: ${storageStatePath}`
    );
  }

  // Headful mode: navigate to landing and wait for manual login
  console.error('[emergent-mcp] Browser opened. Please log in manually in the browser window.');
  console.error(`[emergent-mcp] Waiting up to 120 seconds for login...`);

  await page.goto(`${EMERGENT_BASE_URL}/landing/`, { waitUntil: 'domcontentloaded' });

  // Wait until the URL changes away from /landing/
  await page.waitForURL(
    (url) => !url.href.includes('/landing') && !url.href.includes('/login') && !url.href.includes('/signin'),
    { timeout: 120_000 }
  );

  console.error('[emergent-mcp] Login detected. Saving session...');
  await saveSession(_context);
  console.error(`[emergent-mcp] Session saved to ${storageStatePath}`);
}

/**
 * Saves the current browser context storage state to disk for session persistence.
 */
export async function saveSession(ctx) {
  if (!ctx) return;
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
  await ctx.storageState({ path: storageStatePath });
}

/**
 * Closes the browser cleanly. Call on process exit.
 */
export async function closeBrowser() {
  if (_context) {
    await saveSession(_context).catch(() => {});
    await _context.close().catch(() => {});
    _context = null;
  }
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

export { EMERGENT_BASE_URL, DEFAULT_TIMEOUT };
