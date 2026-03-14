/**
 * browser.js — Playwright session manager for Emergent.sh
 *
 * Maintains a persistent browser context (cookies + localStorage) so the agent
 * doesn't need to re-authenticate on every tool call. Session data is stored in
 * ~/.emergent-mcp/session/ by default, overridable via EMERGENT_SESSION_DIR.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const EMERGENT_BASE_URL = 'https://app.emergent.sh';
const DEFAULT_TIMEOUT = 30_000;

// Where we persist auth cookies/storage
const SESSION_DIR = process.env.EMERGENT_SESSION_DIR
  ?? join(homedir(), '.emergent-mcp', 'session');

// Singleton state
let _browser = null;
let _context = null;

/**
 * Returns a ready-to-use Playwright BrowserContext, reusing the singleton
 * if already open, restoring a saved session if one exists.
 */
export async function getContext() {
  if (_context) return _context;

  const headless = process.env.EMERGENT_HEADLESS !== 'false'; // default: headless=true

  _browser = await chromium.launch({ headless });

  const storageStatePath = join(SESSION_DIR, 'storage-state.json');
  const ctxOptions = {
    viewport: { width: 1400, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
  };

  _context = await _browser.newContext(ctxOptions);

  // Auto-save session after every navigation so we survive crashes
  _context.on('page', (page) => {
    page.on('load', () => saveSession(_context).catch(() => {}));
  });

  return _context;
}

/**
 * Opens a page to Emergent and ensures the user is logged in.
 * If not logged in and credentials are provided in env vars, performs login.
 * Returns the page object.
 */
export async function getAuthenticatedPage() {
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  await page.goto(EMERGENT_BASE_URL, { waitUntil: 'domcontentloaded' });

  // Check if we're already authenticated
  const isLoggedIn = await checkLoggedIn(page);
  if (!isLoggedIn) {
    await performLogin(page);
  }

  return page;
}

/**
 * Checks whether the current page state is authenticated.
 */
async function checkLoggedIn(page) {
  try {
    const url = page.url();
    if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
      return false;
    }
    const loggedInIndicator = await page.locator(
      '[data-testid="user-avatar"], [aria-label*="account"], button:has-text("New Project"), a:has-text("Dashboard")'
    ).first().isVisible({ timeout: 5000 });
    return loggedInIndicator;
  } catch {
    return false;
  }
}

/**
 * Performs email/password login using env vars.
 * Set EMERGENT_EMAIL and EMERGENT_PASSWORD.
 */
async function performLogin(page) {
  const email = process.env.EMERGENT_EMAIL;
  const password = process.env.EMERGENT_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Not logged in to Emergent.sh. Set EMERGENT_EMAIL and EMERGENT_PASSWORD env vars, ' +
      'or run once with EMERGENT_HEADLESS=false to log in manually and save the session.'
    );
  }

  if (!page.url().includes('/login') && !page.url().includes('/signin')) {
    await page.goto(`${EMERGENT_BASE_URL}/login`, { waitUntil: 'domcontentloaded' }).catch(() =>
      page.goto(`${EMERGENT_BASE_URL}/signin`, { waitUntil: 'domcontentloaded' })
    );
  }

  await page.locator('input[type="email"], input[name="email"]').fill(email);

  const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")');
  if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await continueBtn.click();
    await page.waitForTimeout(500);
  }

  await page.locator('input[type="password"], input[name="password"]').fill(password);
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').click();

  await page.waitForURL((url) => !url.href.includes('/login') && !url.href.includes('/signin'), {
    timeout: 15_000,
  });

  await saveSession(_context);
}

/**
 * Saves the current browser context storage state to disk for session persistence.
 */
export async function saveSession(ctx) {
  if (!ctx) return;
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
  await ctx.storageState({ path: join(SESSION_DIR, 'storage-state.json') });
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
