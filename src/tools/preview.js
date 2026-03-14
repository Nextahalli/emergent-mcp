/**
 * tools/preview.js — Access and test the Emergent app preview
 *
 * Emergent offers multiple preview modes:
 *   1. Inline iframe preview in the project pane
 *   2. "Open in new tab" full-page preview
 *   3. A shareable preview link (sometimes different from the deployed URL)
 *
 * This module extracts the best available preview URL and can run a
 * Playwright sub-session to perform automated UI testing against it.
 */

import { getAuthenticatedPage, EMERGENT_BASE_URL } from '../browser.js';

/**
 * emergent_get_preview_url
 * Extracts the live preview URL for the current build of a project.
 * Tries three strategies in order: iframe src, href on a preview button, clicking the button.
 *
 * @param {object} params
 * @param {string} params.projectId - Project ID or full URL
 * @param {boolean} [params.captureScreenshot=true] - Capture and return a base64 PNG screenshot
 * @returns {object} { previewUrl, previewType: 'iframe'|'tab', screenshotBase64 }
 */
export async function getPreviewUrl({ projectId, captureScreenshot = true }) {
  const page = await getAuthenticatedPage();

  try {
    await navigateToProject(page, projectId);
    await page.waitForTimeout(2000);

    // Strategy 1: inline iframe
    const iframeSrc = await page.evaluate(() => {
      for (const iframe of document.querySelectorAll('iframe')) {
        const src = iframe.src;
        if (src && src !== 'about:blank' && !src.includes('analytics') && !src.includes('intercom')) {
          return src;
        }
      }
      return null;
    });

    if (iframeSrc) {
      const screenshot = captureScreenshot ? await captureExternalPage(iframeSrc) : null;
      return { previewUrl: iframeSrc, previewType: 'iframe', screenshotBase64: screenshot };
    }

    // Strategy 2: href on a visible preview link
    const previewBtnHref = await page.evaluate(() => {
      for (const sel of [
        'a[href*="preview"]',
        'a[target="_blank"]',
        'a[aria-label*="Preview" i]',
        '[data-testid*="preview"] a',
      ]) {
        const el = document.querySelector(sel);
        if (el?.href) return el.href;
      }
      return null;
    });

    if (previewBtnHref) {
      const screenshot = captureScreenshot ? await captureExternalPage(previewBtnHref) : null;
      return { previewUrl: previewBtnHref, previewType: 'tab', screenshotBase64: screenshot };
    }

    // Strategy 3: click the preview button and intercept the new tab
    const openBtn = page.locator(
      'button:has-text("Preview"), button:has-text("Open"), button:has-text("View app"), ' +
      '[data-testid="preview-btn"], [aria-label*="Open preview"]'
    ).first();

    if (await openBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const [newPage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 10_000 }),
        openBtn.click(),
      ]);
      const tabUrl = newPage.url();
      let screenshot = null;
      if (captureScreenshot) {
        await newPage.waitForLoadState('networkidle');
        screenshot = (await newPage.screenshot({ type: 'png' })).toString('base64');
      }
      await newPage.close();
      return { previewUrl: tabUrl, previewType: 'tab', screenshotBase64: screenshot };
    }

    return { previewUrl: null, previewType: null, screenshotBase64: null, error: 'No preview URL found' };
  } finally {
    await page.close();
  }
}

/**
 * emergent_test_preview
 * Runs a list of Playwright-backed UI test scenarios against the app preview.
 * Leave tests=[] to run the built-in smoke suite.
 *
 * Supported actions: click | fill | check_text | check_visible | check_no_error | screenshot | navigate
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} [params.previewUrl] - Use this URL directly instead of fetching from the project
 * @param {Array}  [params.tests]      - Test scenario objects
 * @returns {object} { passed, failed, totalTests, results }
 */
export async function testPreview({ projectId, previewUrl, tests = [] }) {
  let targetUrl = previewUrl;
  if (!targetUrl) {
    const { previewUrl: fetched, error } = await getPreviewUrl({ projectId, captureScreenshot: false });
    if (!fetched) {
      return { passed: 0, failed: 1, results: [{ description: 'Get preview URL', passed: false, error }] };
    }
    targetUrl = fetched;
  }

  const { getContext } = await import('../browser.js');
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  const results = [];

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    const testList = tests.length > 0 ? tests : defaultSmokeTests();
    for (const test of testList) {
      results.push(await runSingleTest(page, test, targetUrl));
    }
  } catch (err) {
    results.push({ description: 'Page load', passed: false, error: err.message });
  } finally {
    await page.close();
  }

  return {
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    totalTests: results.length,
    results,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function runSingleTest(page, test, baseUrl) {
  const { description, action, selector, value, waitFor: waitForSel } = test;
  try {
    switch (action) {
      case 'navigate':
        await page.goto(value || baseUrl, { waitUntil: 'domcontentloaded' });
        break;
      case 'click':
        await page.locator(selector).first().click();
        break;
      case 'fill':
        await page.locator(selector).first().fill(value ?? '');
        break;
      case 'check_text': {
        const body = await page.locator('body').textContent();
        if (!body?.includes(value))
          return { description, passed: false, error: `Text "${value}" not found on page` };
        break;
      }
      case 'check_visible': {
        const visible = await page.locator(selector).first().isVisible({ timeout: 5000 });
        if (!visible)
          return { description, passed: false, error: `Selector "${selector}" not visible` };
        break;
      }
      case 'screenshot': {
        const buf = await page.screenshot({ type: 'png', fullPage: true });
        return { description, passed: true, screenshotBase64: buf.toString('base64') };
      }
      case 'check_no_error': {
        const body = await page.locator('body').textContent();
        const found = ['Error', '404', 'Not Found', 'Cannot GET', 'Application error'].find(
          (e) => body?.includes(e)
        );
        if (found)
          return { description, passed: false, error: `Error text found: "${found}"` };
        break;
      }
      default:
        return { description, passed: false, error: `Unknown action: ${action}` };
    }
    if (waitForSel)
      await page.locator(waitForSel).waitFor({ state: 'visible', timeout: 8000 });
    return { description, passed: true };
  } catch (err) {
    return { description, passed: false, error: err.message };
  }
}

function defaultSmokeTests() {
  return [
    { description: 'Page loads without error text', action: 'check_no_error' },
    { description: 'Body has visible content', action: 'check_visible', selector: 'body *' },
    { description: 'Full-page screenshot', action: 'screenshot' },
  ];
}

async function captureExternalPage(url) {
  try {
    const { getContext } = await import('../browser.js');
    const ctx = await getContext();
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    const buf = await p.screenshot({ type: 'png' });
    await p.close();
    return buf.toString('base64');
  } catch {
    return null;
  }
}

async function navigateToProject(page, projectIdOrUrl) {
  const url = projectIdOrUrl.startsWith('http')
    ? projectIdOrUrl
    : `${EMERGENT_BASE_URL}/project/${projectIdOrUrl}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}
