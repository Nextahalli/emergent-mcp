#!/usr/bin/env node
/**
 * src/index.js — Emergent.sh MCP Server
 *
 * Exposes all Emergent automation tools to any MCP-compatible client
 * (OpenClaw, Claude Code, Claude Desktop, Cursor, etc.) over stdio.
 *
 * Uses the Emergent REST API directly — no browser needed for most operations.
 *
 * Usage:
 *   EMERGENT_EMAIL=you@example.com EMERGENT_PASSWORD=secret npx @openclaw/emergent-mcp
 *
 * Or add to your MCP client config:
 *   {
 *     "mcpServers": {
 *       "emergent": {
 *         "command": "npx",
 *         "args": ["-y", "@openclaw/emergent-mcp"],
 *         "env": {
 *           "EMERGENT_EMAIL": "you@example.com",
 *           "EMERGENT_PASSWORD": "yourpassword"
 *         }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// API-based tools (no browser needed)
import { createProject, listProjects, getProject, respondToAgentTool, wakeEnvironment, waitForBuild } from './tools/project.js';
import { getPreviewUrl, screenshotPreview } from './tools/preview.js';
import { getCredits, getCreditSummary } from './tools/credits.js';

// Browser-based tools (fallback for unsupported API operations)
import { getDeploymentStatus } from './tools/deployment.js';
import { discoverFeatures } from './tools/discover.js';
import { closeBrowser } from './browser.js';

const TOOLS = [
  // ── Project Management ────────────────────────────────────────────────────
  {
    name: 'emergent_create_project',
    description:
      'Create a new project on Emergent.sh by submitting a prompt. ' +
      'The AI agent will start building immediately. Returns a job ID you can use to monitor progress.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Full instructions for what to build. Be specific — include design requirements, tech stack preferences, data structures, and any constraints.',
        },
        modelName: {
          type: 'string',
          description: 'AI model to use (default: claude-sonnet-4-5)',
          enum: ['claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4', 'gpt-4o'],
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'emergent_list_projects',
    description: 'List your recent Emergent.sh projects/jobs with their status and preview URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results to return (default: 20)' },
      },
    },
  },
  {
    name: 'emergent_get_project',
    description: 'Get full details for a specific project including status, preview URL, and credits used.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID (UUID)' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'emergent_wait_for_build',
    description:
      'Poll a job until it completes (or fails/times out). ' +
      'Use after emergent_create_project to wait for the build to finish.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID to monitor' },
        timeoutMinutes: { type: 'number', description: 'Max wait time in minutes (default: 20)' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'emergent_respond_to_agent',
    description:
      'Respond to a HITL (human-in-the-loop) question from the Emergent agent. ' +
      'Use when the agent has paused and is waiting for your input to continue building.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID of the paused build' },
        response: { type: 'string', description: 'Your answer to the agent\'s question' },
      },
      required: ['jobId', 'response'],
    },
  },
  {
    name: 'emergent_wake_environment',
    description: 'Wake up a sleeping Emergent environment (auto-sleeps after ~30min inactivity).',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID of the sleeping environment' },
      },
      required: ['jobId'],
    },
  },

  // ── Preview ───────────────────────────────────────────────────────────────
  {
    name: 'emergent_get_preview',
    description: 'Get the live preview URL for a built Emergent project.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID' },
        includeVscode: { type: 'boolean', description: 'Also return VS Code editor URL' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'emergent_screenshot_preview',
    description:
      'Take screenshots of the live preview at multiple viewport sizes (phone, tablet, laptop, TV). ' +
      'Requires Playwright (installed automatically with the package).',
    inputSchema: {
      type: 'object',
      properties: {
        previewUrl: { type: 'string', description: 'Preview URL to screenshot' },
        outputDir: { type: 'string', description: 'Directory to save screenshots (default: /tmp)' },
        viewports: {
          type: 'array',
          items: { type: 'string', enum: ['phone', 'tablet', 'laptop', 'tv'] },
          description: 'Viewport sizes to capture (default: [phone, laptop])',
        },
      },
      required: ['previewUrl'],
    },
  },

  // ── Credits ───────────────────────────────────────────────────────────────
  {
    name: 'emergent_get_credits',
    description:
      'Get the current credit balance for the Emergent account. ' +
      'Returns ECU balance, monthly credits, daily credits, plan name, and refresh date.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'emergent_credit_summary',
    description: 'Get a short human-readable credit balance summary.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Discovery (browser-based fallback) ───────────────────────────────────
  {
    name: 'emergent_discover_features',
    description:
      '[Browser] Discover and document available Emergent.sh features. ' +
      'Only needed for features not yet in the REST API.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Tool Dispatch ────────────────────────────────────────────────────────────

async function callTool(name, args) {
  switch (name) {
    case 'emergent_create_project':     return createProject(args);
    case 'emergent_list_projects':      return listProjects(args);
    case 'emergent_get_project':        return getProject(args);
    case 'emergent_wait_for_build':     return waitForBuild(args);
    case 'emergent_respond_to_agent':   return respondToAgentTool(args);
    case 'emergent_wake_environment':   return wakeEnvironment(args);
    case 'emergent_get_preview':        return getPreviewUrl(args);
    case 'emergent_screenshot_preview': return screenshotPreview(args);
    case 'emergent_get_credits':        return getCredits();
    case 'emergent_credit_summary':     return getCreditSummary();
    case 'emergent_discover_features':  return discoverFeatures({});
    default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

// ─── MCP Server Setup ─────────────────────────────────────────────────────────

const server = new Server(
  { name: 'emergent-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await callTool(name, args ?? {});
    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(
      ErrorCode.InternalError,
      `${name} failed: ${err.message}`,
    );
  }
});

process.on('SIGINT', async () => {
  await closeBrowser().catch(() => {});
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('emergent-mcp v0.2.0 started (API-first mode)');
