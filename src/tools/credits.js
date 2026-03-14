/**
 * tools/credits.js — Track credit usage per project and account-wide balance
 */

import { getAuthenticatedPage, EMERGENT_BASE_URL } from '../browser.js';

export async function getCreditInfo({ projectId }) {
  const page = await getAuthenticatedPage();

  try {
    await navigateToProject(page, projectId);
    await page.waitForTimeout(1500);

    const infoButton = page.locator(
      'button[aria-label*="info" i], ' +
      'button[aria-label*="Info" i], ' +
      'button[aria-label*="credits" i], ' +
      'button:has-text("Info"), ' +
      'button:has-text("ℹ"), ' +
      '[data-testid*="info"], ' +
      '[data-testid*="credit"]'
    ).first();

    const hasInfoBtn = await infoButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasInfoBtn) {
      await infoButton.click();
      await page.waitForTimeout(800);
    }

    const creditData = await page.evaluate(() => {
      const creditContainers = [
        ...document.querySelectorAll('[class*="credit"], [class*="usage"], [class*="info"], [role="dialog"], [role="tooltip"]'),
      ];

      let rawText = '';
      for (const el of creditContainers) {
        const text = el.textContent?.trim();
        if (text && (text.toLowerCase().includes('credit') || text.match(/\d+/))) {
          rawText += text + '\n';
        }
      }

      const creditBadge = document.querySelector(
        '[class*="credit-count"], [class*="credits-used"], [data-testid*="credit"]'
      );

      return {
        rawText: rawText.trim() || document.body.innerText.slice(0, 2000),
        badge: creditBadge?.textContent?.trim() ?? null,
      };
    });

    const numbers = creditData.rawText.match(/[\d,]+(?:\.\d+)?/g)?.map((n) => parseFloat(n.replace(',', ''))) ?? [];
    const creditsUsed = numbers[0] ?? null;

    return {
      projectId,
      creditsUsed,
      creditsDetail: creditData.badge,
      rawText: creditData.rawText.slice(0, 1000),
    };
  } finally {
    await page.close();
  }
}

export async function getAccountCredits() {
  const page = await getAuthenticatedPage();

  try {
    const paths = ['/settings', '/account', '/billing', '/credits', '/settings/billing', '/settings/credits'];

    let landed = false;
    for (const path of paths) {
      try {
        await page.goto(`${EMERGENT_BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await page.waitForTimeout(1000);

        const hasCredits = await page.locator('body').evaluate((body) =>
          body.innerText.toLowerCase().includes('credit')
        );

        if (hasCredits) { landed = true; break; }
      } catch { continue; }
    }

    if (!landed) {
      await page.goto(EMERGENT_BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
    }

    const accountData = await page.evaluate(() => {
      const creditElements = [
        ...document.querySelectorAll('[class*="credit"], [class*="balance"], [class*="plan"]'),
      ];
      const details = creditElements.map((el) => el.textContent?.trim()).filter(Boolean).join('\n');
      return { rawText: (details || document.body.innerText).slice(0, 2000) };
    });

    const remainMatch = accountData.rawText.match(
      /(\d[\d,]*(?:\.\d+)?)\s*credits?\s*(?:remaining|left|available)/i
    );
    const planMatch = accountData.rawText.match(/plan[:\s]+(\w+)/i);

    return {
      creditsRemaining: remainMatch ? parseFloat(remainMatch[1].replace(',', '')) : null,
      creditsPlan: planMatch?.[1] ?? null,
      rawText: accountData.rawText.slice(0, 800),
    };
  } finally {
    await page.close();
  }
}

async function navigateToProject(page, projectIdOrUrl) {
  const url = projectIdOrUrl.startsWith('http')
    ? projectIdOrUrl
    : `${EMERGENT_BASE_URL}/project/${projectIdOrUrl}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}
