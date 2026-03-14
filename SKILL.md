---
name: Emergent.sh Builder
version: 0.1.0
description: Build, test, monitor, and manage apps on Emergent.sh using browser automation.
author: Wildest AI
license: MIT
requires:
  - package: "@openclaw/emergent-mcp"
    via: npx
env:
  - EMERGENT_EMAIL: Your Emergent.sh account email
  - EMERGENT_PASSWORD: Your Emergent.sh account password
tags: [emergent, app-builder, web, deployment, browser-automation]
---

# Emergent.sh Builder Skill

## What This Skill Does

This skill lets you use Emergent.sh — an AI-powered web and app builder — as a fully automated tool in your agent workflow. You can create apps from a prompt, have a full conversation with the Emergent agent to refine them, test the live preview, track credit spend, and monitor deployments.

## When to Use This Skill

Invoke this skill when the user asks to:
- "Build me a website / app / landing page / dashboard / tool"
- "Create a [anything] on Emergent"
- "Open / resume / continue my Emergent project"
- "How many Emergent credits do I have left?"
- "Test the app Emergent built"
- "Check if my Emergent deployment is live"
- Any request involving creating, modifying, or checking on a web app via Emergent.sh

---

## Setup

First run — set env vars before starting:

```bash
export EMERGENT_EMAIL="you@example.com"
export EMERGENT_PASSWORD="yourpassword"
```

For Google OAuth / SSO (manual login):
```bash
EMERGENT_HEADLESS=false npx @openclaw/emergent-mcp
# Log in manually in the browser. Session is saved automatically.
```

---

## Standard Workflows

### 1. Build a New App (end-to-end)

```
Step 1: Check credits before starting
  → emergent_get_account_credits()

Step 2: Discover new Emergent features (once per session)
  → emergent_discover_features()

Step 3: Create the project with a rich, detailed first prompt
  → emergent_create_project({ prompt: "...", template: "..." })
  Returns: { projectId, projectUrl, agentResponse }

Step 4: Answer any agent questions in agentResponse
  → emergent_send_message({ projectId, message: "answers to questions" })
  Repeat until agentResponse has no more "?" or blockers.

Step 5: Get the preview and screenshot
  → emergent_get_preview_url({ projectId })

Step 6: Run automated tests
  → emergent_test_preview({ projectId, tests: [...] })

Step 7: Check credit spend for this project
  → emergent_get_credit_info({ projectId })
```

### 2. Resume a Previous Project

```
Step 1: List projects
  → emergent_list_projects()

Step 2: Resume by ID
  → emergent_resume_project({ projectId: "abc123" })

Step 3: If hasQuestions=true, answer them
  → emergent_send_message({ projectId, message: "..." })
```

### 3. Monitor a Deployment

```
Step 1: Check status
  → emergent_get_deployment_status({ projectId })

Step 2: Poll until live
  → emergent_monitor_deployment({ deployedUrl, timeoutMs: 120000 })
```

---

## First-Prompt Best Practices

Always include in the first prompt:
1. **What the app does** — the core user action
2. **Who uses it** — the audience
3. **Tech preference** — if any (e.g. "React frontend")
4. **Visual style** — colours, vibe, font
5. **What NOT to include** — explicit exclusions save credits

❌ Bad: "Build me a todo app"
✅ Good: "Build a minimal single-user to-do app in React. Users can add tasks, mark them done (strikethrough), and delete them. No auth, no backend — store in localStorage. Dark mode, clean sans-serif UI, no external dependencies."

---

## Handling Agent Questions

When agentResponse contains questions:
1. Parse all questions out
2. Answer each one concisely
3. Send **all answers in a single** `emergent_send_message` call
4. Wait for the next agentResponse and check again

Do not send multiple single-answer messages — batch everything together.

---

## Credit Awareness

- Always call `emergent_get_account_credits()` before starting a new project
- Warn the user if credits are below 50 before proceeding
- After each major generation round, call `emergent_get_credit_info({ projectId })` to track spend
- If credits run out mid-generation, inform the user and suggest resuming after a top-up

---

## Testing Strategy

```json
[
  { "description": "Page loads", "action": "check_no_error" },
  { "description": "Main heading visible", "action": "check_visible", "selector": "h1" },
  { "description": "Primary CTA visible", "action": "check_visible", "selector": "button" },
  { "description": "Screenshot for review", "action": "screenshot" },
  { "description": "Key text present", "action": "check_text", "value": "expected text" }
]
```

If tests fail due to selector issues, fall back to the screenshot action and describe what you see to the user.

---

## Feature Discovery

Run `emergent_discover_features()` at session start (cached for 6 hours). If `newFeatures` is non-empty:
1. Read the new features
2. Update your mental model of what's available on the home screen
3. Prefer new template options when they exist
4. Inform the user: "Emergent added [X] — want me to use it?"

---

## Error Handling

| Error | What to do |
|---|---|
| "Not logged in" | Ask user to set env vars, or run with `EMERGENT_HEADLESS=false` |
| "No preview URL found" | Build may still be generating. Wait 30s and retry |
| "Selector not visible" in tests | Emergent UI changed. Fall back to screenshot |
| Credits-related error | Call `emergent_get_account_credits()` and report |
| Network timeout | Retry once. If it fails again, report the `projectUrl` |

---

## Tool Reference

| Tool | Purpose |
|---|---|
| `emergent_create_project` | Start a new app from a prompt |
| `emergent_send_message` | Send follow-up / answer agent questions |
| `emergent_read_response` | Read full chat history |
| `emergent_get_preview_url` | Get live preview URL + screenshot |
| `emergent_test_preview` | Run UI tests on preview |
| `emergent_get_credit_info` | Per-project credit usage |
| `emergent_get_account_credits` | Total account credits remaining |
| `emergent_list_projects` | List all projects on dashboard |
| `emergent_resume_project` | Open an existing project |
| `emergent_get_deployment_status` | Check deploy status + live URL |
| `emergent_monitor_deployment` | Poll until deployment is live |
| `emergent_discover_features` | Detect new Emergent features |
