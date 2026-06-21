# Browser Automation — Playwright MCP

All browser steps in the workflows (navigate / click / type / upload / read URL)
are performed through the **Playwright MCP** server, NOT by writing scripts.

## Server config

Registered in the project root `.mcp.json` as server name `playwright`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "-y", "@playwright/mcp@latest",
        "--browser", "chromium",
        "--user-data-dir", "/Users/nhut/.cache/import-lab-recform/pw-profile",
        "--allow-unrestricted-file-access"
      ]
    }
  }
}
```

- `--user-data-dir` → a **persistent profile**, so the dashboard + Google login
  survive between runs (log in once, see below).
- `--allow-unrestricted-file-access` → required because the input PDFs live in
  `~/Downloads` (outside the project workspace) and must be selectable in file
  upload dialogs.

> If the `playwright` MCP tools are not available when the skill runs, tell the
> user to approve/enable the `playwright` MCP server for this project (Claude
> Code prompts to trust `.mcp.json` on first use), then continue.

## First-run login (once)

Before the first PDF, ensure the persistent profile is logged in:

1. Use the Playwright MCP to navigate to `<DASHBOARD_URL>/admin/`.
2. If it shows a login page → ask the user to log in **in the opened browser
   window**, then confirm. (The session is saved in the profile for next time.)
3. Also navigate to `https://docs.google.com` once and confirm Google is logged
   in (needed to read/duplicate Sheet tabs for `gid`).

## Tool mapping (Playwright MCP)

| Workflow phrase | Playwright MCP action |
|-----------------|------------------------|
| "Navigate to URL" | `browser_navigate` |
| "Open new tab → navigate" | `browser_tabs` (new) then `browser_navigate` |
| "Click X" | `browser_snapshot` to find the element, then `browser_click` |
| "Type / fill field" | `browser_type` |
| "Select option from dropdown" | `browser_type` to filter, `browser_snapshot`, then `browser_click` the option (these admin dropdowns are searchable selects, not native `<select>`) |
| "Upload file" | `browser_file_upload` with the absolute PDF path |
| "Read gid from URL" | `browser_snapshot` (it reports the page URL) or `browser_evaluate` returning `location.href`, then parse `gid=` |
| "Wait for success message" | `browser_wait_for` on the expected text |

## Notes

- Take a `browser_snapshot` before clicking so you target the right element.
- The admin "select2"-style dropdowns need: click to open → type to filter →
  wait for results → click the matching option.
- Keep ONE browser context for the whole run so login + tabs persist.
