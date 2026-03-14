# @openclaw/emergent-mcp

MCP server for controlling [Emergent.sh](https://app.emergent.sh) via browser automation. Lets any MCP-compatible agent (OpenClaw, Claude Code, Claude Desktop) create apps, test previews, track credits, and monitor deployments on Emergent — with no public API required.

---

## How It Works

Emergent has no public REST API. This server uses **Playwright** (headless Chromium) to drive the Emergent UI exactly as a human would — navigating, clicking, filling inputs, and reading responses. Auth sessions are persisted to `~/.emergent-mcp/session/` so you only log in once.

---

## Installation

```bash
# Run directly (no install needed):
npx @openclaw/emergent-mcp

# Or install globally:
npm install -g @openclaw/emergent-mcp
```

Playwright installs Chromium automatically via the `postinstall` script.

---

## Authentication

**Option A — Email/Password:**
```bash
export EMERGENT_EMAIL="you@example.com"
export EMERGENT_PASSWORD="yourpassword"
npx @openclaw/emergent-mcp
```

**Option B — Manual login (Google OAuth, SSO, etc.):**
```bash
EMERGENT_HEADLESS=false npx @openclaw/emergent-mcp
# A browser window opens. Log in manually. Session is saved automatically.
# All future runs use the saved session headlessly.
```

---

## MCP Client Config

Add to `mcp.json`, Claude Desktop config, or OpenClaw config:

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

---

## Available Tools (12)

| Tool | Description |
|---|---|
| `emergent_create_project` | Start a new app from a prompt |
| `emergent_send_message` | Send follow-up messages / answer agent questions |
| `emergent_read_response` | Read full conversation history |
| `emergent_get_preview_url` | Extract live preview URL + optional screenshot |
| `emergent_test_preview` | Run automated UI tests against the preview |
| `emergent_get_credit_info` | Per-project credit usage (via the Info button) |
| `emergent_get_account_credits` | Total account credits remaining |
| `emergent_list_projects` | List all projects in the dashboard |
| `emergent_resume_project` | Open an existing project |
| `emergent_get_deployment_status` | Deployment status + live URL |
| `emergent_monitor_deployment` | Poll until a deployment is live |
| `emergent_discover_features` | Detect new Emergent features + UI changes |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `EMERGENT_EMAIL` | — | Account email for login |
| `EMERGENT_PASSWORD` | — | Account password for login |
| `EMERGENT_HEADLESS` | `true` | Set to `false` to open a visible browser |
| `EMERGENT_SESSION_DIR` | `~/.emergent-mcp/session` | Where auth session is saved |

---

## Project Structure

```
emergent-mcp/
├── package.json
├── SKILL.md              ← OpenClaw skill definition
├── CLAUDE.md             ← Claude Code context
├── README.md
└── src/
    ├── index.js          ← MCP server entry point + tool registry
    ├── browser.js        ← Playwright session manager
    └── tools/
        ├── project.js    ← create / list / resume
        ├── chat.js       ← send_message / read_response
        ├── preview.js    ← get_preview_url / test_preview
        ├── credits.js    ← get_credit_info / get_account_credits
        ├── deployment.js ← get_deployment_status / monitor_deployment
        └── discover.js   ← discover_features
```

---

## Selector Maintenance

Emergent ships features frequently. If a tool fails with selector errors:

1. Run `EMERGENT_HEADLESS=false npx @openclaw/emergent-mcp`
2. Navigate to the failing area in the visible browser
3. Use DevTools → Inspector to find updated selectors
4. Edit the relevant file in `src/tools/`

All selectors use multiple fallbacks (`data-testid` → class patterns → text content), so partial UI changes often work without any changes.

Run `emergent_discover_features({ forceRefresh: true })` to get a fresh snapshot of what's on the Emergent UI before debugging selectors.

---

## Contributing

PRs updating selectors, adding new tool capabilities as Emergent ships features, or improving test coverage are very welcome.

When Emergent releases a public API, tools should be updated to use REST calls — the MCP tool interface stays the same, only the implementation changes.

---

## License

MIT
