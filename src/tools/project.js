/**
 * tools/project.js — Create, list, and resume Emergent projects
 */

import { getAuthenticatedPage, EMERGENT_BASE_URL } from '../browser.js';

export async function createProject({ prompt, template = null, visibility = 'private' }) {
  const page = await getAuthenticatedPage();

  try {
    await page.goto(EMERGENT_BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    if (template) {
      const templateCard = page.locator(
        `[data-testid="template-card"]:has-text("${template}"), ` +
        `.template-card:has-text("${template}"), ` +
        `button:has-text("${template}")`
      ).first();

      if (await templateCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await templateCard.click();
        await page.waitForTimeout(500);
      }
    }

    if (visibility === 'public') {
      const publicToggle = page.locator(
        'button:has-text("Public"), [aria-label*="Public"], input[value="public"]'
      ).first();
      if (await publicToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        await publicToggle.click();
      }
    }

    const promptInput = page.locator(
      'textarea[placeholder*="Describe"], ' +
      'textarea[placeholder*="What do you want"], ' +
      'textarea[placeholder*="Build"], ' +
      'textarea[placeholder*="idea"], ' +
      '[data-testid="prompt-input"], ' +
      '.prompt-input textarea, ' +
      'textarea'
    ).first();

    await promptInput.waitFor({ state: 'visible', timeout: 10_000 });
    await promptInput.fill(prompt);

    const submitBtn = page.locator(
      'button[type="submit"]:visible, ' +
      'button:has-text("Build"), ' +
      'button:has-text("Create"), ' +
      'button:has-text("Generate"), ' +
      'button:has-text("Start"), ' +
      '[data-testid="submit-prompt"]'
    ).first();

    await submitBtn.click();

    await page.waitForURL((url) => url.href.includes('/project') || url.href.includes('/app'), {
      timeout: 20_000,
    });

    const projectUrl = page.url();
    const projectId = extractProjectId(projectUrl);
    const agentResponse = await waitForAgentResponse(page, { timeout: 60_000 });

    return { projectId, projectUrl, agentResponse };
  } finally {
    await page.close();
  }
}

export async function listProjects() {
  const page = await getAuthenticatedPage();

  try {
    // Navigate to the root dashboard (Emergent redirects authenticated users here)
    await page.goto(EMERGENT_BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Dump all debug info if requested
    if (process.env.EMERGENT_DEBUG) {
      const { mkdirSync, writeFileSync } = await import('fs');
      mkdirSync('/tmp/emergent-debug', { recursive: true });
      await page.screenshot({ path: '/tmp/emergent-debug/list-projects.png', fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => '');
      writeFileSync('/tmp/emergent-debug/list-projects.html', html);
    }

    // Broad selector: find all links that contain /project/ in their href
    const projects = await page.evaluate(() => {
      const seen = new Set();
      const result = [];

      // Try all anchor elements with /project/ in href
      const anchors = [...document.querySelectorAll('a[href*="/project"]')];
      for (const el of anchors) {
        const href = el.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);

        const card = el.closest('[class*="card"], [class*="project"], li, article') ?? el;
        result.push({
          name: card.querySelector('h2, h3, h4, [class*="title"], [class*="name"]')?.textContent?.trim()
            ?? el.textContent?.trim().slice(0, 80)
            ?? 'Unknown',
          url: href,
          id: href.split('/project/')[1]?.split('/')[0] ?? href.split('/').pop(),
          lastUpdated: card.querySelector('[class*="date"], [class*="time"], time, [class*="ago"]')?.textContent?.trim() ?? null,
          status: card.querySelector('[class*="status"], [class*="badge"]')?.textContent?.trim() ?? 'unknown',
        });
      }
      return result;
    });

    return projects;
  } finally {
    await page.close();
  }
}

export async function resumeProject({ projectId }) {
  const page = await getAuthenticatedPage();

  try {
    const projectUrl = projectId.startsWith('http')
      ? projectId
      : `${EMERGENT_BASE_URL}/project/${projectId}`;

    await page.goto(projectUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const currentUrl = page.url();
    const resolvedId = extractProjectId(currentUrl);
    const lastAgentMessage = await getLastAgentMessage(page);
    const hasQuestions = await checkIfAgentWaiting(page);

    return { projectId: resolvedId, projectUrl: currentUrl, lastAgentMessage, hasQuestions };
  } finally {
    await page.close();
  }
}

export function extractProjectId(url) {
  const match = url.match(/\/project\/([^/?#]+)|\/app\/([^/?#]+)/);
  return match?.[1] ?? match?.[2] ?? url.split('/').filter(Boolean).pop();
}

export async function waitForAgentResponse(page, { timeout = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  const thinkingSelector =
    '[class*="thinking"], [class*="loading"], [class*="generating"], ' +
    '[aria-label*="generating"], .spinner, [class*="spinner"]';

  await page.waitForTimeout(2000);
  await page.locator(thinkingSelector).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await page.locator(thinkingSelector).first().waitFor({
    state: 'hidden',
    timeout: deadline - Date.now(),
  }).catch(() => {});
  await page.waitForTimeout(500);

  return getLastAgentMessage(page);
}

async function getLastAgentMessage(page) {
  return page.evaluate(() => {
    const messageSelectors = [
      '[data-role="assistant"] .message-content',
      '[data-sender="agent"] .message-content',
      '.assistant-message .content',
      '.agent-message',
      '[class*="assistant-message"]',
      '[class*="agent-message"]',
      '.message:not(.user):last-child',
    ];

    for (const sel of messageSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) return els[els.length - 1].textContent?.trim() ?? null;
    }
    return null;
  });
}

async function checkIfAgentWaiting(page) {
  const inputEnabled = await page.locator('textarea:enabled, input[type="text"]:enabled').first()
    .isVisible({ timeout: 2000 }).catch(() => false);
  const stillGenerating = await page.locator(
    '[class*="thinking"], [class*="generating"], .spinner'
  ).first().isVisible({ timeout: 1000 }).catch(() => false);
  return inputEnabled && !stillGenerating;
}
