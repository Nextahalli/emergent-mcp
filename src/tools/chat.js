/**
 * tools/chat.js — Send messages and read agent responses in an Emergent project
 */

import { getAuthenticatedPage } from '../browser.js';
import { extractProjectId, waitForAgentResponse } from './project.js';

export async function sendMessage({ projectId, message, waitForResponse = true }) {
  const page = await getAuthenticatedPage();

  try {
    await navigateToProject(page, projectId);

    const chatInput = page.locator(
      'textarea[placeholder*="message"], ' +
      'textarea[placeholder*="Ask"], ' +
      'textarea[placeholder*="Type"], ' +
      'textarea[placeholder*="Reply"], ' +
      '[data-testid="chat-input"], ' +
      '.chat-input textarea, ' +
      'form textarea'
    ).last();

    await chatInput.waitFor({ state: 'visible', timeout: 10_000 });
    await chatInput.click();
    await chatInput.fill(message);

    const sendBtn = page.locator(
      'button[type="submit"]:visible, ' +
      'button[aria-label*="Send"]:visible, ' +
      'button[aria-label*="send"]:visible, ' +
      '[data-testid="send-button"]:visible'
    ).first();

    const hasSendBtn = await sendBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (hasSendBtn) {
      await sendBtn.click();
    } else {
      await chatInput.press('Enter');
    }

    if (!waitForResponse) return { sent: true };

    const agentResponse = await waitForAgentResponse(page, { timeout: 90_000 });
    return { sent: true, agentResponse };
  } finally {
    await page.close();
  }
}

export async function readResponse({ projectId, lastN = null }) {
  const page = await getAuthenticatedPage();

  try {
    await navigateToProject(page, projectId);
    await page.waitForTimeout(1000);

    const { messages, isGenerating } = await page.evaluate(() => {
      const messageContainers = [
        ...document.querySelectorAll('[data-role], [data-sender], .message, .chat-message, [class*="message-bubble"]'),
      ];

      const messages = messageContainers.map((el) => {
        const role =
          el.dataset.role ||
          el.dataset.sender ||
          (el.className.includes('user') ? 'user' : 'assistant');

        return {
          role: role === 'user' ? 'user' : 'assistant',
          content: el.querySelector('.content, .message-content, p')?.textContent?.trim()
            ?? el.textContent?.trim(),
        };
      }).filter((m) => m.content && m.content.length > 0);

      const isGenerating = !!document.querySelector(
        '[class*="thinking"], [class*="generating"], [class*="loading"], .spinner'
      );

      return { messages, isGenerating };
    });

    const trimmed = lastN ? messages.slice(-lastN) : messages;
    const lastAssistant = [...trimmed].reverse().find((m) => m.role === 'assistant');
    const hasQuestions = lastAssistant?.content?.includes('?') ?? false;

    return { messages: trimmed, isGenerating, hasQuestions };
  } finally {
    await page.close();
  }
}

async function navigateToProject(page, projectIdOrUrl) {
  const { EMERGENT_BASE_URL } = await import('../browser.js');
  const url = projectIdOrUrl.startsWith('http')
    ? projectIdOrUrl
    : `${EMERGENT_BASE_URL}/project/${projectIdOrUrl}`;

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}
