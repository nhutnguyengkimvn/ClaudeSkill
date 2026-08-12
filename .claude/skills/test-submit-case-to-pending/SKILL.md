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
  - `pss_account` — PSS credentials, keyed by environment:
    `pss_account.dev` / `pss_account.prod`, each `{ email, password }`. Use
    the block matching the run's `environment`; a missing block → STOP.
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
   `{ url, email, password, caseId }` (email/password from
   `pss_account.<env>`) → run. Logs in as PSS (hard-logout +
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

- **A section body can hang on "Loading… ⟳" — bounce, don't wait** (user-reported
  2026-08-07). The heading renders before the form body mounts, and the body can
  stick on `Loading... ⟳` indefinitely; every input poll then reads an EMPTY form
  and the run aborts with a misleading "answers did not take effect". **Rule: if
  the body is still "Loading…" after ~2s, click another section, wait ~1s, click
  back** — the remount loads instantly. Encoded as `openSection(name, bounceTo)`
  in pss-02 (3 attempts). Same helper lives in fast-02 and prov-02.

- **A JS `el.click()` does NOT register with Form.io — values REVERT** (hit
  2026-07-30, the worst kind of failure because it reports success). All 15
  Compliance radios read back `checked: true` right after the JS clicks, then
  Save wiped every one of them and validation showed "This field is required"
  ×15 with `reasonSet: null`. Form.io keeps its own data model; only a TRUSTED
  Playwright click updates it. pss-02 now (a) builds a PLAN inside
  `page.evaluate` without clicking, then (b) applies it with
  `setInput()` — trusted `click({force:true})`, read the value back, retry until
  it sticks. Same helper ticks the verification checkboxes and the
  `admin-pss-confirm` box. Never replace it with a JS click for speed.
- **The activity panel shows only the ONE latest entry**, so log-only save
  verification fails on a re-run over an already-saved section (no new log line
  for a no-op save). Accept a GREEN sidebar marker (`circle fill="#227110"`) as
  the second proof — note that `svg.gk-section-valid-icon` is the ERROR icon.
- **Speed:** poll with `until()`, never `waitForTimeout`. Fixed sleeps cost ~3s
  per section on the swal poll alone; the confirm dialog is now raced against
  the activity log.

- **The stale-session retry needs `page.reload()`** (fixed 2026-07-27): clearing
  storage/cookies + `goto()` on a `#/` hash URL does not re-render the SPA, so
  the login form never appears and the old session survives with the wrong role.
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
  `alreadyPending` path handles this. **DEV ONLY** — see the prod quirk below.

### PROD-only quirks (first prod run, 2026-08-12, CA-5115F6LB)

- **No auto-transition on prod, and `Mark as Pending` is blocked until
  MEDICAL HISTORY is saved.** pss-03 returns
  `Mark as Pending blocked: "complete all required fields"` while every
  section pss-02 touches is green. Diagnosis: read the sidebar icons — the
  blocking section is the one carrying `svg.gk-section-valid-icon` (red
  `#D82636`); a section with NO icon is merely optional (Primary Care
  Provider / Family History / Social History all show no icon and do not
  block). On the prod run only **Medical History** blocked, and it needs one
  required checkbox ticked:
  `data[patient_personal_history_progress_note_reviewed_document]`
  ("Past surgical history was reviewed and documented *"). Tick it (trusted
  label click) → visible Save → the section goes green → re-run pss-03, which
  then clicks Mark as Pending and reaches **Pending**. The
  "Current Medical Complaint *" textarea can stay empty — it does not block.
  Medical History is NOT in `pss-data.json`; it is filled ad-hoc for now.
- **Radios/checkboxes are styled `opacity: 0` on prod** — a forced click on
  the `<input>` silently does nothing. pss-02's `setInput` already falls back
  to the wrapping label, which is what makes it work; never simplify that
  ladder back to an input-only click.
- The **Medications "I confirm that I have verified…" checkbox does not exist**
  on the prod build (`confirm: "not found"`), and the save succeeds anyway.
- **Compliance has REQUIRED "Verified Patient Gender / DOB / Address / Phone"
  checkboxes** (`data[compliance_verification_verified_patient_*]`). The
  empty-`.formio-form`-wrapper quirk applies to CHECKBOXES too, not just
  radios: the checkbox root must be the visible form that actually *contains*
  checkboxes. Symptom when it isn't (hit 2026-07-27): all 15 radios answer
  fine, `checkboxes: "0 checked"`, Save silently fails validation
  ("Verified Patient … is required") and the activity-log verification times
  out with `failedSection: Compliance`. pss-02 now ticks by the correct root
  and aborts if any required box is left unchecked.
- The Medications confirm box is `name="admin-pss-confirm"`, an app-custom
  checkbox OUTSIDE any `.formio-form` → it must be searched document-wide.

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
