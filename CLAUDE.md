# emergent-mcp — Claude Code Context

## What This Project Is

An MCP (Model Context Protocol) server that lets AI agents (OpenClaw, Claude Code, Claude Desktop, etc.) control [Emergent.sh](https://app.emergent.sh) via **Playwright browser automation**. Emergent has no public REST API, so this server drives the UI headlessly — the same way a human would.

It exposes 12 tools covering the full Emergent workflow: creating projects, chatting with the Emergent agent, testing previews, tracking credits, and monitoring deployments.

## Stack

- **Runtime**: Node.js ≥18, ES Modules (`"type": "module"`)
- **Browser automation**: Playwright (Chromium)
- **MCP transport**: stdio via `@modelcontextprotocol/sdk`
- **No build step** — plain JS, runs directly with `node src/index.js`

## Project Structure

```
src/
├── index.js          ← MCP server: registers all 12 tools, handles stdio transport
├── browser.js        ← Playwright session manager (singleton context, session persistence)
└── tools/
    ├── project.js    ← emergent_create_project, emergent_list_projects, emergent_resume_project
    ├── chat.js       ← emergent_send_message, emergent_read_response
    ├── preview.js    ← emergent_get_preview_url, emergent_test_preview
    ├── credits.js    ← emergent_get_credit_info, emergent_get_account_credits
    ├── deployment.js ← emergent_get_deployment_status, emergent_monitor_deployment
    └── discover.js   ← emergent_discover_features
SKILL.md              ← OpenClaw agent instructions (when/how to use the tools)
README.md             ← User-facing docs
```

## Key Architecture Decisions

### Session Persistence
`src/browser.js` maintains a **singleton** Playwright `BrowserContext`. Auth cookies/localStorage are saved to `~/.emergent-mcp/session/storage-state.json` after every page load so the agent survives restarts without re-authenticating.

### Selector Strategy
All selectors use **multiple fallbacks** in priority order: `data-testid` → semantic attributes (`aria-label`) → class patterns → visible text. This makes the server resilient to Emergent's frequent UI updates. Example:
```js
page.locator(
  '[data-testid="chat-input"], .chat-input textarea, form textarea'
).last()
```

### Tool Error Handling
Tools **never throw** to the MCP client. Errors are returned as structured JSON with `{ error, tool }` and `isError: true` so the calling agent can read the message and decide what to do next (retry, report to user, etc.).

### Feature Discovery Cache
`discover.js` caches the scraped feature list in `~/.emergent-mcp/cache/features.json` with a 6-hour TTL. On each run it diffs against the cache and returns `newFeatures` / `changedFeatures` — letting agents self-update their knowledge of Emergent's UI.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `EMERGENT_EMAIL` | — | Login email |
| `EMERGENT_PASSWORD` | — | Login password |
| `EMERGENT_HEADLESS` | `true` | Set to `false` to open a visible browser (useful for debugging selectors or manual OAuth login) |
| `EMERGENT_SESSION_DIR` | `~/.emergent-mcp/session` | Override session storage location |

## Running Locally

```bash
# Install deps
npm install

# Run the MCP server (reads/writes stdio — connect via an MCP client)
EMERGENT_EMAIL=you@example.com EMERGENT_PASSWORD=secret node src/index.js

# First-time manual login (for Google OAuth):
EMERGENT_HEADLESS=false node src/index.js
```

## Adding to Claude Code / Claude Desktop

```json
{
  "mcpServers": {
    "emergent": {
      "command": "node",
      "args": ["/Users/apple/Work/Personal/opensource/emergent-mcp/src/index.js"],
      "env": {
        "EMERGENT_EMAIL": "you@example.com",
        "EMERGENT_PASSWORD": "yourpassword"
      }
    }
  }
}
```

Or via npx once published:
```json
{
  "mcpServers": {
    "emergent": {
      "command": "npx",
      "args": ["-y", "@openclaw/emergent-mcp"],
      "env": { "EMERGENT_EMAIL": "...", "EMERGENT_PASSWORD": "..." }
    }
  }
}
```

## Common Development Tasks

### Updating a broken selector
1. Run with `EMERGENT_HEADLESS=false` to open a visible browser
2. Navigate to the broken area
3. Open DevTools → Inspector, find the updated selector
4. Edit the relevant file in `src/tools/` — add the new selector as the **first** option in the fallback chain

### Adding a new tool
1. Implement the function in the appropriate `src/tools/*.js` file (or create a new one)
2. Export it and import it in `src/index.js`
3. Add the tool definition object to the `TOOLS` array in `src/index.js`
4. Add the handler to the `TOOL_HANDLERS` map in `src/index.js`
5. Document the tool in `SKILL.md` (agent instructions) and `README.md` (user docs)

### Debugging a specific tool
```bash
# Run with visible browser to watch what's happening
EMERGENT_HEADLESS=false EMERGENT_EMAIL=... EMERGENT_PASSWORD=... node src/index.js
```
Then call the tool from your MCP client and watch the browser.

### Publishing to npm
```bash
npm login
npm publish --access public
```

## Known Limitations & Future Work

- **No public Emergent API yet** — if Emergent ships a REST API, replace the Playwright implementation in each tool with fetch() calls. The MCP tool interface stays unchanged.
- **Selector drift** — Emergent ships UI changes frequently. Run `emergent_discover_features({ forceRefresh: true })` when tools start failing to get a fresh UI snapshot before debugging.
- **Screenshot base64** — `emergent_get_preview_url` and `emergent_test_preview` return screenshots as base64 PNG. MCP clients that support image content blocks can render these directly; others will receive the raw base64 string.
- **No background auth refresh** — if the Emergent session expires mid-run, the next tool call will attempt re-login using env vars. If env vars aren't set, it throws a descriptive error.
