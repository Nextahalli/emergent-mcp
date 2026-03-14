/**
 * tools/deployment.js — Monitor deployed Emergent applications
 */

import { getAuthenticatedPage, EMERGENT_BASE_URL } from '../browser.js';

export async function getDeploymentStatus({ projectId, pingDeployment = true }) {
  const page = await getAuthenticatedPage();

  try {
    await navigateToProject(page, projectId);
    await page.waitForTimeout(1500);

    const deploymentData = await page.evaluate(() => {
      const statusEl = document.querySelector(
        '[class*="deploy-status"], [class*="deployment-status"], ' +
        '[data-testid*="deploy"], [aria-label*="deploy" i], ' +
        'span:has-text("Deployed"), span:has-text("Live"), span:has-text("Building")'
      );

      const deployedLinks = [
        ...document.querySelectorAll('a[href*=".vercel.app"], a[href*=".netlify.app"], a[href*=".pages.dev"], a[href*="emergent.sh/app"]'),
      ];

      const liveBtns = [
        ...document.querySelectorAll(
          'a[aria-label*="visit" i], a[aria-label*="live" i], a[aria-label*="deployed" i], ' +
          'button:has-text("Visit"), button:has-text("Open app"), a:has-text("View live")'
        ),
      ];

      const deployedUrl = deployedLinks[0]?.href || liveBtns[0]?.href || null;
      const deployTimeEl = document.querySelector('[class*="deploy-time"], [class*="deployed-at"], time');
      const logsEl = document.querySelector('[class*="logs"], [class*="build-output"], pre');

      return {
        status: statusEl?.textContent?.trim() ?? 'unknown',
        deployedUrl,
        deployedAt: deployTimeEl?.textContent?.trim() ?? deployTimeEl?.getAttribute('datetime') ?? null,
        logs: logsEl?.textContent?.slice(0, 2000) ?? null,
      };
    });

    let pingResult = null;
    if (pingDeployment && deploymentData.deployedUrl) {
      pingResult = await pingUrl(page, deploymentData.deployedUrl);
    }

    return {
      projectId,
      status: deploymentData.status,
      deployedUrl: deploymentData.deployedUrl,
      deployedAt: deploymentData.deployedAt,
      pingResult,
      logs: deploymentData.logs,
    };
  } finally {
    await page.close();
  }
}

export async function monitorDeployment({ deployedUrl, pollIntervalMs = 10_000, timeoutMs = 120_000, expectText }) {
  const { getContext } = await import('../browser.js');
  const ctx = await getContext();
  const page = await ctx.newPage();

  const history = [];
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let reachedStatus = 'timeout';

  try {
    while (Date.now() < deadline) {
      attempts++;
      const result = await pingUrl(page, deployedUrl, expectText);
      history.push({ timestamp: new Date().toISOString(), ...result });

      if (result.alive && (!expectText || result.hasExpectedText)) {
        reachedStatus = 'up';
        break;
      }

      await page.waitForTimeout(Math.min(pollIntervalMs, deadline - Date.now()));
    }
  } finally {
    await page.close();
  }

  return { deployedUrl, reachedStatus, attempts, history };
}

async function pingUrl(page, url, expectText = null) {
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const status = response?.status() ?? 0;
    const alive = status >= 200 && status < 400;

    let hasExpectedText = null;
    if (expectText) {
      const bodyText = await page.locator('body').textContent();
      hasExpectedText = bodyText?.includes(expectText) ?? false;
    }

    const title = await page.title().catch(() => null);
    return { url, alive, httpStatus: status, title, hasExpectedText, error: null };
  } catch (err) {
    return { url, alive: false, httpStatus: null, title: null, hasExpectedText: false, error: err.message };
  }
}

async function navigateToProject(page, projectIdOrUrl) {
  const url = projectIdOrUrl.startsWith('http')
    ? projectIdOrUrl
    : `${EMERGENT_BASE_URL}/project/${projectIdOrUrl}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}
