/**
 * tools/project.js — Create, list, resume, and monitor Emergent projects
 *
 * Uses the Emergent REST API directly (no browser required).
 * Falls back to browser automation only for operations not yet in the API.
 */

import {
  createTask,
  listJobs,
  getJob,
  getPreview,
  respondToAgent,
  restartEnvironment,
  pollUntilDone,
} from '../api-client.js';
import { randomUUID } from 'node:crypto';

/**
 * emergent_create_project
 * Create a new project/app on Emergent.sh by submitting a prompt.
 *
 * @param {object} params
 * @param {string} params.prompt - Full instructions for the AI agent
 * @param {string} [params.modelName] - Model to use (default: claude-sonnet-4-5)
 * @param {string} [params.envImage] - Environment image override
 * @returns {object} { jobId, clientRefId, status, previewUrl }
 */
export async function createProject({ prompt, modelName, envImage }) {
  const clientRefId = randomUUID();
  const result = await createTask(prompt, clientRefId, { modelName, envImage });

  return {
    jobId: result.id ?? clientRefId,
    clientRefId: result.client_ref_id ?? clientRefId,
    status: result.status,
    message: result.message,
  };
}

/**
 * emergent_list_projects
 * List recent Emergent projects/jobs.
 *
 * @param {object} params
 * @param {number} [params.limit=20] - How many to return
 * @returns {object[]} Array of job summaries
 */
export async function listProjects({ limit = 20 } = {}) {
  const data = await listJobs(limit);
  const jobs = data.jobs ?? data ?? [];
  return jobs.map((j) => ({
    id: j.id,
    title: j.title,
    status: j.status,
    state: j.state,
    previewUrl: j.preview_url,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
  }));
}

/**
 * emergent_get_project
 * Get full details for a specific project/job.
 *
 * @param {object} params
 * @param {string} params.jobId - Job ID (UUID or short ID)
 * @returns {object} Full job details
 */
export async function getProject({ jobId }) {
  const job = await getJob(jobId);
  let preview = null;
  try {
    const p = await getPreview(jobId);
    preview = p.preview_url ?? null;
  } catch {}

  return {
    id: job.id,
    title: job.title,
    status: job.status,
    state: job.state,
    previewUrl: preview,
    creditsUsed: job.credits_used,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

/**
 * emergent_respond_to_agent
 * Respond to a HITL (human-in-the-loop) question from the Emergent agent.
 * Use this when the agent is waiting for your input to continue building.
 *
 * @param {object} params
 * @param {string} params.jobId - The job waiting for input
 * @param {string} params.response - Your answer to the agent's question
 * @returns {object} API response
 */
export async function respondToAgentTool({ jobId, response }) {
  return respondToAgent(jobId, response);
}

/**
 * emergent_wake_environment
 * Wake up a sleeping environment (Emergent sleeps environments after inactivity).
 *
 * @param {object} params
 * @param {string} params.jobId - Job ID
 * @returns {object} API response
 */
export async function wakeEnvironment({ jobId }) {
  return restartEnvironment(jobId);
}

/**
 * emergent_wait_for_build
 * Poll a job until it completes (or fails/times out).
 * Returns the final job status and preview URL.
 *
 * @param {object} params
 * @param {string} params.jobId - Job ID to monitor
 * @param {number} [params.timeoutMinutes=20] - Max wait time
 * @returns {object} { jobId, status, previewUrl, creditsUsed }
 */
export async function waitForBuild({ jobId, timeoutMinutes = 20 }) {
  const updates = [];
  const job = await pollUntilDone(jobId, {
    timeoutMs: timeoutMinutes * 60 * 1000,
    onPoll: (j) => {
      const entry = `${new Date().toISOString().slice(11, 19)} | ${j.status}/${j.state}`;
      updates.push(entry);
      console.error(entry); // stderr so it shows in MCP logs
    },
  });

  let previewUrl = null;
  try {
    const p = await getPreview(jobId);
    previewUrl = p.preview_url ?? null;
  } catch {}

  return {
    jobId: job.id,
    status: job.status,
    state: job.state,
    previewUrl,
    creditsUsed: job.credits_used,
    statusLog: updates,
  };
}
