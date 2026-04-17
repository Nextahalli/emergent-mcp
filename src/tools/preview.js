/**
 * tools/preview.js — Access the live preview for an Emergent project
 *
 * Uses the Emergent REST API directly.
 * For screenshot capture, uses Playwright (optional — only if installed).
 */

import { getPreview, getJob } from '../api-client.js';

/**
 * emergent_get_preview
 * Get the live preview URL for a built project.
 *
 * @param {object} params
 * @param {string} params.jobId - Job ID
 * @param {boolean} [params.includeVscode=false] - Include the VS Code editor URL
 * @returns {object} { previewUrl, vsCodeUrl, password, screenshotUrl }
 */
export async function getPreviewUrl({ jobId, includeVscode = false }) {
  const data = await getPreview(jobId);

  const result = {
    previewUrl: data.preview_url ?? data.base_preview_url,
    screenshotUrl: data.preview_screenshot_url ?? null,
    status: 'available',
  };

  if (includeVscode) {
    result.vsCodeUrl = data.vscode_url ?? null;
    result.password = data.password ?? null;
  }

  if (!result.previewUrl) {
    const job = await getJob(jobId);
    result.status = job.status;
    result.message = `Preview not available yet (job status: ${job.status}/${job.state})`;
  }

  return result;
}

/**
 * emergent_screenshot_preview
 * Take a screenshot of the live preview at multiple viewport sizes.
 * Requires Playwright to be installed (included as a dependency).
 *
 * @param {object} params
 * @param {string} params.previewUrl - The preview URL to screenshot
 * @param {string} [params.outputDir] - Directory to save screenshots (default: /tmp)
 * @param {string[]} [params.viewports] - Viewport names: phone, tablet, laptop, tv
 * @returns {object} { screenshots: [{ name, path, width, height }] }
 */
export async function screenshotPreview({ previewUrl, outputDir = '/tmp', viewports = ['phone', 'laptop'] }) {
  const VIEWPORTS = {
    phone:  { width: 375,  height: 812  },
    tablet: { width: 768,  height: 1024 },
    laptop: { width: 1440, height: 900  },
    tv:     { width: 1920, height: 1080 },
  };

  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return { error: 'Playwright not installed. Run: npm install playwright && npx playwright install chromium' };
  }

  const { chromium } = playwright;
  const browser = await chromium.launch({ headless: true });
  const screenshots = [];

  try {
    for (const name of viewports) {
      const vp = VIEWPORTS[name] ?? VIEWPORTS.laptop;
      const page = await browser.newPage({ viewport: vp });
      await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(2000);
      const filePath = `${outputDir}/${name}.png`;
      await page.screenshot({ path: filePath, fullPage: name !== 'phone' });
      screenshots.push({ name, path: filePath, width: vp.width, height: vp.height });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  return { screenshots };
}
