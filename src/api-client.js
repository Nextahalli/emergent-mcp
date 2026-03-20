/**
 * api-client.js — Direct REST API client for Emergent.sh
 *
 * This is the reliable, browser-free approach to the Emergent API.
 * Uses the Supabase auth endpoint for login and the Emergent REST API
 * for all operations — no Playwright required for API operations.
 *
 * Auth flow:
 *   1. POST to Supabase /auth/v1/token with email+password → access_token
 *   2. Pass token as "Authorization: Bearer <token>" on all API calls
 *   3. Token expires in ~7 days; use refresh_token to get a new one
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SUPABASE_URL = 'https://snksxwkyumhdykyrhhch.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNua3N4d2t5dW1oZHlreXJoaGNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjQ3NzI2NDYsImV4cCI6MjA0MDM0ODY0Nn0.3unO6zdz2NilPL2xdxt7OjvZA19copj3Q7ulIjPVDLQ';
const EMERGENT_API = 'https://api.emergent.sh';
const TOKEN_CACHE_PATH = path.join(os.homedir(), '.emergent-mcp', 'api-token.json');

// ─── Token Management ─────────────────────────────────────────────────────────

let _tokenCache = null;

function loadTokenCache() {
  if (_tokenCache) return _tokenCache;
  try {
    if (fs.existsSync(TOKEN_CACHE_PATH)) {
      _tokenCache = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8'));
      return _tokenCache;
    }
  } catch {}
  return null;
}

function saveTokenCache(data) {
  _tokenCache = data;
  try {
    fs.mkdirSync(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(data, null, 2));
  } catch {}
}

function isTokenValid(cache) {
  if (!cache?.access_token || !cache?.expires_at) return false;
  return Date.now() < cache.expires_at - 60_000; // 1-minute buffer
}

/**
 * Login with email + password (or use cached token).
 * Credentials are read from environment variables:
 *   EMERGENT_EMAIL, EMERGENT_PASSWORD
 *
 * @returns {Promise<string>} access_token
 */
export async function login() {
  const cached = loadTokenCache();
  if (isTokenValid(cached)) return cached.access_token;

  // Try refresh first
  if (cached?.refresh_token) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: cached.refresh_token }),
      });
      if (res.ok) {
        const data = await res.json();
        saveTokenCache({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000,
        });
        return data.access_token;
      }
    } catch {}
  }

  // Full login
  const email = process.env.EMERGENT_EMAIL;
  const password = process.env.EMERGENT_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set EMERGENT_EMAIL and EMERGENT_PASSWORD env vars, or run: emergent-mcp-login'
    );
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Login failed: ${err.error_description || err.message || res.status}`);
  }

  const data = await res.json();
  saveTokenCache({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

// ─── Core API Request ─────────────────────────────────────────────────────────

async function apiRequest(method, path, body = null) {
  const token = await login();
  const url = `${EMERGENT_API}${path}`;

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw Object.assign(new Error(`Emergent API ${method} ${path} → ${res.status}: ${errText.slice(0, 200)}`), {
      statusCode: res.status,
    });
  }

  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Jobs API ─────────────────────────────────────────────────────────────────

/**
 * Create a new task / project on Emergent.sh.
 *
 * @param {string} prompt - The full prompt / instructions for the AI agent
 * @param {string} [clientRefId] - Optional idempotency key (UUID)
 * @param {object} [opts]
 * @param {string} [opts.modelName] - Model to use (default: claude-sonnet-4-5)
 * @param {string} [opts.envImage] - Environment image (default: '' = auto-select)
 * @returns {Promise<object>} { status, client_ref_id, message }
 */
export async function createTask(prompt, clientRefId = null, opts = {}) {
  const { randomUUID } = await import('node:crypto');
  const refId = clientRefId ?? randomUUID();

  return apiRequest('POST', '/jobs/v0/submit-queue/', {
    client_ref_id: refId,
    payload: {
      task: prompt,
      processor_type: 'env_only',
      is_cloud: true,
      env_image: opts.envImage ?? '',
      branch: '',
      repository: '',
    },
    model_name: opts.modelName ?? 'claude-sonnet-4-5',
  });
}

/**
 * Get full details for a job by ID.
 */
export async function getJob(jobId) {
  return apiRequest('GET', `/jobs/v0/${jobId}/`);
}

/**
 * List recent jobs.
 */
export async function listJobs(limit = 20) {
  return apiRequest('GET', `/jobs/v0/?limit=${limit}&offset=0`);
}

/**
 * Get the preview URL for a job's built application.
 * @returns {Promise<object>} { preview_url, base_preview_url, vscode_url, password }
 */
export async function getPreview(jobId) {
  return apiRequest('GET', `/jobs/v0/${jobId}/preview`);
}

/**
 * Respond to a HITL (human-in-the-loop) question from the agent.
 * The agent's question can be found in the chat history or by monitoring
 * the preview/UI. This resumes the build with your answer.
 *
 * @param {string} jobId - The job waiting for input
 * @param {string} responseText - Your answer to the agent's question
 */
export async function respondToAgent(jobId, responseText) {
  const job = await getJob(jobId);
  const clientRefId = job.client_ref_id || jobId;
  const envImage = job.payload?.env_image || '';
  const modelName = job.payload?.model_name || 'claude-sonnet-4-5';

  // IMPORTANT: for HITL resume, client_ref_id AND id must both be the
  // original job's client_ref_id, and env_image/model_name must match.
  return apiRequest('POST', '/jobs/v0/hitl-queue/', {
    client_ref_id: clientRefId,
    payload: {
      task: responseText,
      processor_type: 'env_only',
      is_cloud: true,
      env_image: envImage,
      branch: '',
      repository: '',
    },
    model_name: modelName,
    resume: true,
    id: clientRefId,
  });
}

/**
 * Stop a running job.
 */
export async function stopJob(jobId) {
  return apiRequest('POST', '/jobs/stop', { job_id: jobId });
}

/**
 * Restart a sleeping environment.
 */
export async function restartEnvironment(jobId) {
  return apiRequest('POST', `/jobs/v0/${jobId}/restart-environment`, {});
}

// ─── Credits API ──────────────────────────────────────────────────────────────

/**
 * Get the current credit balance for the authenticated account.
 * @returns {Promise<object>} {
 *   ecu_balance,         // total credits remaining
 *   monthly_credits_balance,
 *   daily_credits,
 *   monthly_credits_refresh_date,
 *   subscription: { name, status, monthly_credit_limit, expires_at }
 * }
 */
export async function getCreditsBalance() {
  return apiRequest('GET', '/credits/balance');
}

/**
 * Get a human-readable credits summary string.
 * @returns {Promise<string>} e.g. "17.80 ECU (7.80 monthly + 10.00 daily) | Plan: Emergent Standard"
 */
export async function getCreditsSummary() {
  const b = await getCreditsBalance();
  const total = b.ecu_balance?.toFixed(2) ?? '?';
  const monthly = b.monthly_credits_balance?.toFixed(2) ?? '?';
  const daily = b.daily_credits?.toFixed(2) ?? '?';
  const plan = b.subscription?.name ?? 'unknown';
  const refresh = b.monthly_credits_refresh_date?.split('T')[0] ?? '?';
  return `${total} ECU (${monthly} monthly + ${daily} daily) | Plan: ${plan} | Refresh: ${refresh}`;
}

// ─── GitHub Integration ────────────────────────────────────────────────────────

/**
 * List GitHub app installations (orgs/accounts) connected to this Emergent account.
 */
export async function listGitHubInstallations() {
  return apiRequest('GET', '/github/installations');
}

/**
 * Create a new GitHub repository via the Emergent GitHub integration.
 * @param {object} opts
 * @param {number} opts.installationId - GitHub app installation ID (from listGitHubInstallations)
 * @param {string} opts.name - Repository name
 * @param {string} [opts.description] - Repository description
 * @param {boolean} [opts.private=false] - Make the repo private
 */
export async function createGitHubRepo(opts = {}) {
  return apiRequest('POST', '/github/repositories', {
    installation_id: opts.installationId,
    name: opts.name,
    description: opts.description ?? '',
    private: opts.private ?? false,
  });
}

/**
 * Poll a job until it reaches a terminal status.
 * @param {string} jobId
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=15000] - Poll interval
 * @param {number} [opts.timeoutMs=1200000] - Max wait (20 min default)
 * @param {Function} [opts.onPoll] - Called with job on each poll: onPoll(job)
 * @returns {Promise<object>} Final job object
 */
export async function pollUntilDone(jobId, opts = {}) {
  const {
    intervalMs = 15_000,
    timeoutMs = 20 * 60 * 1000,
    onPoll = null,
  } = opts;
  const TERMINAL = new Set(['completed', 'failed', 'stopped', 'error',
    'COMPLETED', 'FAILED', 'STOPPED', 'ERROR', 'FINISHED']);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const job = await getJob(jobId);
    if (onPoll) onPoll(job);
    if (TERMINAL.has(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for job ${jobId}`);
    await sleep(intervalMs);
  }
}
