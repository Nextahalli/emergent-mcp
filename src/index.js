#!/usr/bin/env node
/**
 * src/index.js — Emergent.sh MCP Server
 *
 * Exposes all Emergent automation tools to any MCP-compatible client
 * (OpenClaw, Claude Code, Claude Desktop, etc.) over stdio.
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

import { closeBrowser } from './browser.js';
import { createProject, listProjects, resumeProject } from './tools/project.js';
import { sendMessage, readResponse } from './tools/chat.js';
import { getPreviewUrl, testPreview } from './tools/preview.js';
import { getCreditInfo, getAccountCredits } from './tools/credits.js';
import { getDeploymentStatus, monitorDeployment } from './tools/deployment.js';
import { discoverFeatures } from './tools/discover.js';

const TOOLS = [
  {
    name: 'emergent_create_project',
    description:
      'Create a new Emergent.sh project. Navigates to the home screen, selects configuration, ' +
      'submits the first prompt, and returns the project URL and the agent\'s first response.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Initial prompt describing what to build' },
        template: { type: 'string', description: 'Optional template name (e.g. "React App", "Landing Page")' },
        visibility: { type: 'string', enum: ['public', 'private'], description: 'Project visibility (default: private)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'emergent_send_message',
    description:
      'Send a follow-up message in an existing Emergent project chat. Use this to answer the agent\'s ' +
      'questions, give clarifications, or request changes. Returns the agent\'s reply.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID or full project URL' },
        message: { type: 'string', description: 'Message to send to the Emergent agent' },
        waitForResponse: { type: 'boolean', description: 'Wait for and return the agent\'s reply (default: true)' },
      },
      required: ['projectId', 'message'],
    },
  },
  {
    name: 'emergent_read_response',
    description:
      'Read the full conversation history of an Emergent project. Returns all messages with roles, ' +
      'whether the agent is still generating, and whether it has open questions.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID or full project URL' },
        lastN: { type: 'number', description: 'Only return the last N messages (default: all)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'emergent_get_preview_url',
    description:
      'Extracts the live preview URL from an Emergent project. Tries iframe first, then external tab links. ' +
      'Optionally captures a screenshot of the preview.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID or full project URL' },
        captureScreenshot: { type: 'boolean', description: 'Capture and return a base64 screenshot (default: true)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'emergent_test_preview',
    description:
      'Run automated UI tests against the Emergent preview of a project. Specify test scenarios ' +
      'or use built-in smoke tests. Returns pass/fail results per test.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID or full project URL' },
        previewUrl: { type: 'string', description: 'Override — use this URL directly instead of fetching from project' },
        tests: {
          type: 'array',
          description: 'Test scenarios to run. Leave empty for default smoke tests.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              action: { type: 'string', enum: ['click', 'fill', 'check_text', 'check_visible', 'screenshot', 'navigate', 'check_no_error'] },
              selector: { type: 'string' },
              value: { type: 'string' },
              waitFor: { type: 'string' },
            },
            required: ['description', 'action'],
          },
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'emergent_get_credit_info',
    description:
      'Check the credit usage for a specific Emergent project. Clicks the info/credits button ' +
      'in the project view and returns consumption details.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID or full project URL' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'emergent_get_account_credits',
    description:
      'Check the total credits remaining in the Emergent account, the plan type, and overall usage. ' +
      'Use this before starting expensive projects to verify sufficient budget.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'emergent_list_projects',
    description:
      'List all projects in the Emergent account dashboard. Returns project names, IDs, URLs, ' +
      'last-updated timestamps, and status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'emergent_resume_project',
    description:
      'Open an existing Emergent project and return its current state — the last agent message, ' +
      'whether there are open questions, and the project URL.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID or full project URL' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'emergent_get_deployment_status',
    description:
      'Check the deployment status of an Emergent project. Returns the live URL (if deployed), ' +
      'build status, deploy timestamp, and optionally pings the live URL to confirm it\'s responding.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID or full project URL' },
        pingDeployment: { type: 'boolean', description: 'Ping the deployed URL to verify it\'s alive (default: true)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'emergent_monitor_deployment',
    description:
      'Poll a deployed URL repeatedly until it comes up, with configurable interval and timeout. ' +
      'Use after triggering a deployment to watch for when it goes live.',
    inputSchema: {
      type: 'object',
      properties: {
        deployedUrl: { type: 'string', description: 'The URL to monitor' },
        pollIntervalMs: { type: 'number', description: 'How often to check in milliseconds (default: 10000)' },
        timeoutMs: { type: 'number', description: 'Total monitoring time in milliseconds (default: 120000)' },
        expectText: { type: 'string', description: 'Optional text to wait for on the page (confirms correct app loaded)' },
      },
      required: ['deployedUrl'],
    },
  },
  {
    name: 'emergent_discover_features',
    description:
      'Scrape the Emergent platform to discover new features, UI options, templates, and capabilities. ' +
      'Diffs against the previous known state so you can adapt to platform changes. ' +
      'Run this at the start of a session to ensure you\'re using the latest Emergent capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        forceRefresh: { type: 'boolean', description: 'Ignore cache and re-scrape (default: false)' },
      },
    },
  },
];

const TOOL_HANDLERS = {
  emergent_create_project: createProject,
  emergent_send_message: sendMessage,
  emergent_read_response: readResponse,
  emergent_get_preview_url: getPreviewUrl,
  emergent_test_preview: testPreview,
  emergent_get_credit_info: getCreditInfo,
  emergent_get_account_credits: getAccountCredits,
  emergent_list_projects: listProjects,
  emergent_resume_project: resumeProject,
  emergent_get_deployment_status: getDeploymentStatus,
  emergent_monitor_deployment: monitorDeployment,
  emergent_discover_features: discoverFeatures,
};

const server = new Server(
  { name: 'emergent-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  try {
    const result = await handler(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err.message, tool: name }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
