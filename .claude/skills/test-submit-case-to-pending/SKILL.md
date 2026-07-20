---
name: test-submit-case-to-pending
description: >
  Moves a DNA Insights case from New to Pending as the PSS account: login with
  the PSS account from data/pss-data.json, search the case ID in the Task List,
  open it and verify the Case ID matches, fill the Compliance and Medications
  sections from the JSON answer sets (skipping anything disabled), click
  "Mark as Pending" only if needed (Compliance save usually auto-transitions
  the case to Pending). The case ID comes from the
  previous /test-create-new-case run via the shared report.json, or is asked
  interactively when run standalone. NO logout at the end — the PSS session
  stays logged in. Part of /test-core-flow (step 2).
  Invoked as `test-submit-case-to-pending`.
---

# Test — Submit Case to Pending (PSS)

Takes a case that `/test-create-new-case` left in status **New** and drives it
to **Pending** using the **PSS** account.

## Data sources

- **Account + answer sets (READ-ONLY):** `data/pss-data.json`
  - `pss_account` — PSS credentials.
  - `compliance` — default answer **Yes**, overrides (hospice → **No**,
    video/audio → **Audio Only**), reason for audio-only, and check all
    verification checkboxes.
  - `medications` — currently taking meds → **No**, allergies → **No**,
    tick the "I confirm that I have verified…" checkbox.
  - Missing/placeholder values → STOP and ask the user. NEVER regenerate.
- **Shared run state (READ-WRITE):**
  `.claude/skills/test-core-flow/state/report.json` — read
  `steps["test-create-new-case"].case_id` + `environment`; merge this skill's
  result into `steps["test-submit-case-to-pending"]` when done.

## Inputs & environment rule

- **From `/test-core-flow`**: do NOT ask anything — `environment` and
  `case_id` come from `state/report.json`.
- **Standalone**: ask in ONE `AskUserQuestion` call:
  1. Environment — **dev** (`https://dev-dashboard.dnainsights.ai/#/`) or
     **prod** (`https://dashboard.dnainsights.ai/#/`).
  2. The **case name / Case ID** to open (e.g. `CA-0MZZN3PE`). If
     `report.json` has a recent case, offer it as the first (Recommended)
     option — but only when its recorded `environment` matches the answer to
     question 1 (a dev case id does not exist on prod and vice versa).

## ⚡ FAST MODE (default — target 1–2 min)

Run the pre-built scripts via `mcp__playwright__browser_run_code_unsafe`
(3 calls). Same landmine rules as `/test-create-new-case` — see its SKILL.md
"Known quirks" + "Run-log lessons"; they apply to this dashboard everywhere.

1. **Read `scripts/pss-01-login-open-case.js`**, replace `__CONFIG__` with
   `{ url, email, password, caseId }` → run. Logs in as PSS (hard-logout +
   retry if a stale session has the wrong role), searches the case, opens the
   first result and **verifies the header Case ID equals the expected one**
   (wrong case → abort).
2. **Read `scripts/pss-02-fill-sections.js`**, replace `__CONFIG__` with the
   `compliance` + `medications` objects → run. Fills every ENABLED radio
   group per the answer set (disabled questions are skipped automatically),
   sets the audio-only reason, ticks the verification checkboxes, and saves
   Compliance + Medications — each save verified against the activity log.
   Other sections are skipped by design.
3. **Run `scripts/pss-03-mark-pending.js`** via `{ filename }`. Verifies the
   badge reached **Pending** — clicks **Mark as Pending** + confirms **Yes**
   only when the Compliance save did NOT already auto-transition the case —
   then screenshots. Idempotent (`alreadyPending: true` on re-runs).
   **NO logout**: the PSS session is intentionally left logged in.

Then: merge the result into `state/report.json`
(`steps["test-submit-case-to-pending"]` with status, case_id, sections,
case_status, screenshot, finished_at) and print the report.

**Error handling:** on failure — ONE screenshot, diagnose against the known
landmines, patch only the failing step, continue. Never restart the flow,
never fall back to per-click driving. If a script surfaces a NEW landmine,
add it to the quirks list + scripts (both this skill and test-create-new-case
share the same app).

### PSS-view quirks (learned on the 2026-07-10 calibration run — encoded in scripts)

- **Case cards need a TRUSTED Playwright click** — JS `el.click()` on
  `.gk-cases-wrapper` does not open the case.
- Several **empty `.formio-form` wrappers are visible at once** — pick the
  one that actually contains radios, never `find(f => f.offsetParent)` alone.
- Some questions are **app-custom radios OUTSIDE any `.formio-form`**
  (e.g. Medications Q1 `name="taking-medications"`) — scan document-wide for
  radios not inside a formio form as well.
- "Reason for audio-only" is a `.formio-component-select` whose Choices
  **options lazy-load** — open it, then `waitFor` the option (≤8s) before
  clicking. It is required; Save stays disabled until it is set.
- **The case auto-transitions New → Pending as soon as Compliance is saved
  completely** — clicking "Mark as Pending" is usually unnecessary; pss-03's
  `alreadyPending` path handles this.

## Report

```
✅ test-submit-case-to-pending done
   Environment:   <dev|prod>
   Case ID:       <CA-…> (verified match)
   Sections:      Compliance ✅ (per pss-data.json) / Medications ✅ / others skipped
   Status:        New → Pending (confirmed)
   Session:       PSS still logged in (by design, no logout)
   Report file:   .claude/skills/test-core-flow/state/report.json
   Screenshot:    pss-case-marked-pending.jpeg
```
