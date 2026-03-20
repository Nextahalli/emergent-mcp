# emergent-mcp

> MCP server for [Emergent.sh](https://emergent.sh) — control the AI-powered full-stack app builder from any MCP-compatible agent.

Build apps, monitor progress, respond to agent questions, preview results, and track credit usage — all from your AI assistant.

## Quick Start

```bash
npx @openclaw/emergent-mcp
```

**Required env vars:**

```bash
export EMERGENT_EMAIL="you@example.com"
export EMERGENT_PASSWORD="yourpassword"
```

Or run the interactive login helper:

```bash
npx @openclaw/emergent-mcp-login
```

## Installation

### Claude Desktop / Claude Code / Cursor

Add to your MCP config (`claude_desktop_config.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "emergent": {
      "command": "npx",
      "args": ["-y", "@openclaw/emergent-mcp"],
      "env": {
        "EMERGENT_EMAIL": "you@example.com",
        "EMERGENT_PASSWORD": "yourpassword"
      }
    }
  }
}
```

### OpenClaw

Add to your OpenClaw config:

```yaml
mcp:
  servers:
    - name: emergent
      command: npx -y @openclaw/emergent-mcp
      env:
        EMERGENT_EMAIL: you@example.com
        EMERGENT_PASSWORD: yourpassword
```

## Available Tools

| Tool | Description |
|------|-------------|
| `emergent_create_project` | Create a new project by submitting a prompt |
| `emergent_list_projects` | List recent projects with status |
| `emergent_get_project` | Get full details for a specific project |
| `emergent_wait_for_build` | Poll until a build completes |
| `emergent_respond_to_agent` | Answer a HITL question from the agent |
| `emergent_wake_environment` | Wake a sleeping environment |
| `emergent_get_preview` | Get the live preview URL |
| `emergent_screenshot_preview` | Screenshot preview at phone/tablet/laptop/TV sizes |
| `emergent_get_credits` | Get full credit balance details |
| `emergent_credit_summary` | Get a short credit balance string |

## Example Usage

Ask your AI assistant:

> "Create a landing page for my coffee shop in Bangalore using emergent-mcp. The shop is called 'Brew & Co', has a 4.9★ rating, and their number is +91 98765 43210. Then take screenshots at phone and laptop sizes."

The agent will:
1. Call `emergent_get_credits` to note starting balance
2. Call `emergent_create_project` with your prompt
3. Call `emergent_wait_for_build` to poll until done
4. Call `emergent_get_preview` to get the live URL
5. Call `emergent_screenshot_preview` for the screenshots
6. Call `emergent_get_credits` again to report credits used

## Architecture

This MCP server uses the **Emergent REST API directly** (no browser automation needed for core operations). Authentication uses the Supabase backend that powers Emergent.

Credentials are cached in `~/.emergent-mcp/api-token.json` and refreshed automatically.

For operations not yet in the REST API (e.g., deployment), the server falls back to Playwright browser automation.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EMERGENT_EMAIL` | Yes* | Account email |
| `EMERGENT_PASSWORD` | Yes* | Account password |

*Not required if you've already logged in via `emergent-mcp-login` (session cached).

## License

MIT
