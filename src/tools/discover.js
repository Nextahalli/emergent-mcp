/**
 * tools/discover.js — Discover new Emergent features and adapt agent behaviour
 *
 * Scrapes the Emergent changelog / "What's new" / homepage for feature signals.
 * Caches results locally (6-hour TTL) and diffs against the previous snapshot
 * so agents can detect and adapt to platform changes automatically.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getAuthenticatedPage, EMERGENT_BASE_URL } from '../browser.js';

const CACHE_DIR = join(homedir(), '.emergent-mcp', 'cache');
const FEATURES_CACHE = join(CACHE_DIR, 'features.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * emergent_discover_features
 *
 * @param {object} [params]
 * @param {boolean} [params.forceRefresh=false] - Bypass cache and scrape fresh
 * @returns {object} { newFeatures, changedFeatures, currentFeatures, lastChecked, isFirstRun, fromCache }
 */
export async function discoverFeatures({ forceRefresh = false } = {}) {
  const cached = loadCache();
  const age = cached ? Date.now() - new Date(cached.scrapedAt).getTime() : Infinity;

  if (cached && !forceRefresh && age < CACHE_TTL_MS) {
    return {
      newFeatures: [],
      changedFeatures: [],
      currentFeatures: cached.features,
      lastChecked: cached.scrapedAt,
      isFirstRun: false,
      fromCache: true,
    };
  }

  const page = await getAuthenticatedPage();
  let currentFeatures = [];

  try {
    // 1. Try dedicated changelog / updates pages
    for (const { path, label } of [
      { path: '/changelog', label: 'changelog' },
      { path: '/whats-new', label: 'whats-new' },
      { path: '/updates', label: 'updates' },
      { path: '/blog', label: 'blog' },
    ]) {
      try {
        await page.goto(`${EMERGENT_BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await page.waitForTimeout(1000);
        const hasContent = await page.evaluate(() => document.body.innerText.length > 200);
        if (!hasContent) continue;
        const scraped = await scrapeFeaturePage(page, label);
        if (scraped.length > 0) { currentFeatures = scraped; break; }
      } catch { continue; }
    }

    // 2. Fall back to homepage feature cards
    if (currentFeatures.length === 0) {
      await page.goto(EMERGENT_BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      currentFeatures = await scrapeHomepageFeatures(page);
    }

    // 3. Always append live UI capability snapshot
    const uiCaps = await scrapeUICapabilities(page);
    currentFeatures.push(...uiCaps);
  } finally {
    await page.close();
  }

  const isFirstRun = !cached;
  const prevFeatures = cached?.features ?? [];
  const prevKeys = new Set(prevFeatures.map((f) => f.id));

  const newFeatures = currentFeatures.filter((f) => !prevKeys.has(f.id));
  const changedFeatures = currentFeatures.filter((f) => {
    const prev = prevFeatures.find((p) => p.id === f.id);
    return prev && prev.description !== f.description;
  });

  saveCache({ features: currentFeatures, scrapedAt: new Date().toISOString() });

  return {
    newFeatures,
    changedFeatures,
    currentFeatures,
    lastChecked: new Date().toISOString(),
    isFirstRun,
    fromCache: false,
  };
}

// ── Scrapers ───────────────────────────────────────────────────────────────────

async function scrapeFeaturePage(page, label) {
  return page.evaluate((label) => {
    const items = [];
    const els = [...document.querySelectorAll('h1,h2,h3,h4,article,[class*="changelog-item"],[class*="release"]')];
    els.forEach((el, idx) => {
      const title = el.querySelector('h1,h2,h3,h4')?.textContent?.trim() || el.textContent?.trim().slice(0, 80);
      const description = el.textContent?.trim().slice(0, 300) || '';
      const date = el.querySelector('time,[class*="date"]')?.textContent?.trim() ?? null;
      if (title && title.length > 3 && title.length < 200) {
        items.push({
          id: `${label}-${idx}-${title.slice(0, 20).toLowerCase().replace(/\s+/g, '-')}`,
          title, description, date, source: label,
        });
      }
    });
    return items.slice(0, 30);
  }, label);
}

async function scrapeHomepageFeatures(page) {
  return page.evaluate(() => {
    const items = [];
    document.querySelectorAll('[class*="feature"],[class*="capability"],[class*="template-card"]').forEach((el, idx) => {
      const title = el.querySelector('h2,h3,strong,[class*="title"]')?.textContent?.trim() || '';
      if (title) {
        items.push({
          id: `home-${idx}-${title.slice(0, 20).toLowerCase().replace(/\s+/g, '-')}`,
          title,
          description: el.textContent?.trim().slice(0, 200),
          date: null,
          source: 'homepage',
        });
      }
    });
    return items;
  });
}

async function scrapeUICapabilities(page) {
  await page.goto(EMERGENT_BASE_URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const items = [];
    document.querySelectorAll(
      'select option,[role="option"],[role="tab"],[role="radiogroup"] label,.tab-button,button[class*="config"],button[class*="template"]'
    ).forEach((el, idx) => {
      const label = el.textContent?.trim();
      if (label && label.length > 1 && label.length < 80) {
        items.push({
          id: `ui-${idx}-${label.slice(0, 20).toLowerCase().replace(/\s+/g, '-')}`,
          title: label,
          description: `UI option on home screen: "${label}"`,
          date: null,
          source: 'ui-capabilities',
        });
      }
    });
    return items;
  });
}

// ── Cache helpers ──────────────────────────────────────────────────────────────

function loadCache() {
  try {
    if (!existsSync(FEATURES_CACHE)) return null;
    return JSON.parse(readFileSync(FEATURES_CACHE, 'utf-8'));
  } catch { return null; }
}

function saveCache(data) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(FEATURES_CACHE, JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}
