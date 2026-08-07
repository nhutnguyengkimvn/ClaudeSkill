---
name: test-create-new-case
description: >
  Creates a new test case end-to-end on the DNA Insights dashboard (dev or prod)
  via Playwright browser tools: login with a sale account, fill the "Create
  case" wizard, then complete and Save each case section (Patient Information,
  Opt-In Consent, Primary Care Provider, Family History), click Submit and
  confirm Yes — case goes Draft → New. Patient data and sale credentials come
  from the existing `data/case-data.json` file — that data file is READ-ONLY
  and never regenerated (writing run results to the shared
  test-core-flow/state/report.json is expected and required). The Medicare ID
  is asked interactively each run and goes into the "Primary Policy #" field.
  Part of /test-core-flow (step 1). Invoked as `test-create-new-case`.
---

# Test — Create New Case

Automates creating a new patient case on the DNA Insights dashboard using the
sale-account flow: login → **Create case** → fill Eligibility Check (page 1) →
**Continue** → fill Personal Information (page 2).

## ⚡ FAST MODE (DEFAULT — target runtime 1–2 min)

Do NOT drive the browser step-by-step with individual click/fill/snapshot
calls. Instead run the pre-built Playwright scripts in `scripts/` via
`mcp__playwright__browser_run_code_unsafe` — 3 tool calls total:

1. **Phases 0–2 as usual** (ask env + medicare_id in ONE `AskUserQuestion`
   call with two questions; read + validate the JSON).
2. **Read `scripts/fast-01-login-create-fill.js`**, replace the `__CONFIG__`
   placeholder with a JSON object
   `{ url, email, password, medicareId, patient, additional }`
   (from case-data.json + user answers), pass the whole thing as `code` to
   `browser_run_code_unsafe`. It logs in, creates the case, fills both wizard
   pages, saves, and returns `{ caseId, patientId, ok }`.
3. **Read `scripts/fast-02-save-sections.js`**, replace `__CONFIG__` with
   `{ opt_in_consent, primary_care_provider, family_history }` and run it.
   It saves all 4 case sections and returns per-section results.
4. **Run `scripts/fast-03-submit-verify.js`** directly via
   `{ filename: "<abs path>" }` (no placeholders). It submits, confirms Yes,
   waits for status **New**, screenshots, and returns the final IDs.
5. **Run `scripts/fast-04-logout.js`** directly via `{ filename: "<abs
   path>" }` (no placeholders). It clicks the account-dropdown logout button
   (`i.fa-right-from-bracket`, bottom-left next to "Online") and verifies the
   login page appears. The run is NOT done until this returns `ok: true`.
6. **Write the shared report**: merge this run's results into
   `.claude/skills/test-core-flow/state/report.json` under
   `steps["test-create-new-case"]` (create the file with `environment` /
   `dashboard_url` if it doesn't exist):
   `{ status, environment, case_id, patient_id, medicare_id, patient,
   sections, case_status, screenshot, finished_at }`.
   `/test-submit-case-to-pending` consumes `case_id` from here.
   (`data/case-data.json` stays READ-ONLY — this rule is about the data
   source, not the report output.)

Then report (Phase 10 format, include `Logout: ✅`). Total: ~6 tool calls,
no full-page snapshots.

**Environment rule:** when invoked from `/test-core-flow`, do NOT ask the
environment — read it from `state/report.json` (the orchestrator already
asked). Only ask dev/prod (and medicare_id) when run standalone.

**Error handling:** each script returns `{ ok: false, error }` or throws with
a Playwright error. On failure: take ONE screenshot, diagnose, and either fix
+ re-run that script, or fall back to the manual phases below **only for the
step that failed** — never restart the whole flow manually.

**Built-in verification (do not remove):** script 01 reads back every field on
both wizard pages and aborts BEFORE Save on any mismatch (`mismatches` list).
Script 02 confirms each section save against the activity log ("updated the
case on <Section>") and aborts with `failedSection` if unconfirmed; it also
refuses to save a wrong Opt-In answer. Script 01 refuses to run if the URL
already has `?cid=` (a case is already open — resume with script 02, never
create a duplicate).

**Do not** take `browser_snapshot` of the whole page unless debugging — the
Task List sidebar makes snapshots huge and slow.

### Known quirks (already handled inside the scripts)

- **A section body can hang on "Loading… ⟳" — bounce, don't wait** (user-reported
  2026-08-07, hit on Opt-In Consent of CA-UU68DKAH). The section HEADING renders
  immediately; the form body is a separate async mount. When it sticks on
  `Loading... ⟳`, **waiting longer never resolves it** — every input-level poll
  reads an EMPTY form and the script aborts with a misleading message
  (`Opt-In answer mismatch before save — got: []`, or "radio never took the
  value"). **Rule: if the body is still "Loading…" after ~2s, click ANOTHER
  section, wait ~1s, then click back** — the remount loads instantly. Encoded as
  `openSection(name, probe)` in fast-02 (3 bounce attempts, then a clear
  `body stuck on "Loading…"` error); same helper is in pss-02 and prov-02.
  Symptom to recognise: sidebar shows the section selected with a red `*` while
  the panel shows only the title + spinner (see screenshot in the 2026-08-07 run).

- The account MUST be a **sale** account. A Doctor/provider login shows a
  red "+ Busy Time" button and NO "+ Create case" → script 01 aborts with a
  clear error. Fix `sale_account` in the JSON, re-run script 01.
- **PSS sessions ALSO show "+ Create case"** and /test-submit-case-to-pending
  leaves its PSS session logged in (no logout, by design) → script 01 also
  requires the "Sales Report" nav item (sales-only) before creating; a stale
  PSS session triggers the hard-logout + fresh-login path automatically.
- **The hard-logout path needs a real `page.reload()`** (fixed 2026-07-27):
  clearing localStorage/cookies then `goto()` on a `#/` hash URL does NOT
  re-render the SPA, so the login form never appears, `doLogin()` no-ops, and
  the stale PSS session survives → script aborts with the misleading
  "account is not a SALE account". Symptom: nav shows QC/Calls/Call Scoring
  instead of Sales Report. Same fix applied to `pss-01`.
- **The role-check must POLL, not single-shot** (fixed 2026-07-29): the nav
  ("Sales Report" / "Call Scoring") renders several seconds AFTER the Task List,
  so checking it once right after login reports the wrong role for a perfectly
  valid session and aborts the run. `isSalesRole()` in fast-01 (and
  `isPssRole()` in pss-01) now poll for up to 20s.
- **Continue can be swallowed by the Eligibility Check** (fixed 2026-07-29):
  while the check is in flight the click does nothing, and a failed/slow check
  paints a red **"Inactive Insurance"** banner in the panel header. The banner is
  NOT fatal and does NOT mean the policy # is wrong — clicking Continue again a
  few seconds later goes through. fast-01 retries Continue up to 3×. Do not
  re-type page-1 fields; they survive the failed check.
- Phone / DOB / Zip are masked inputs → typed key-by-key.
- The State input echoes pasted text twice → cleared via native setter first.
- Reason of Visit / RPM service / PCP reason are Choices.js dropdowns →
  clicked via `.choices__list--dropdown [role="option"]`.
- JSON `rpm_service: "CGM/BGM"` maps to option text "…(CGM or BGM)".
- Save/Submit confirmations use `swal` dialogs → auto-answered **Yes**.
- The Task List drawer overlays the section sidebar → section clicks are
  dispatched via JS.
- Family History Yes/No radios can be DOM-disabled for the sales role. A
  locked section is simply SKIPPED (no Save, `saved.familyHistory:
  "skipped (locked)"`) — it is not required for Submit. Just note the skip in
  the final report, it is not an error.
- The collapsed nav sidebar overlays the "+ Create case" button → JS-click.
- swal dialog buttons are under an overlay → ALWAYS JS-click them, and POLL
  up to ~8-10s for the dialog to appear (a single immediate check misses it).
- Hidden section forms also contain Save buttons — clicking a non-visible
  Save submits EMPTY data and wipes that section's green check. Only ever
  click Save buttons with `offsetParent` set.
- Switching sections with unsaved edits pops "Your unsaved data … will be
  lost" (Cancel/OK) → answer OK before expecting the new section to render.
- Opt-In / Family radios are Form.io inputs → select via
  `input[name*="opt_in_consent_q1"][value="No"]` etc., not via `<label>`.
- After Submit the case may skip past "New" straight to "Assigned" (provider
  auto-pickup) — treat "left Draft" as success, not only "Mark as Pending".

### Run-log lessons (from the 2026-07-08 runs — read before changing anything)

**Run 1 (manual, 14 min) and Run 2 (fast v1, ~10 min) both lost most of their
time to the same category of problem: diagnosing UI landmines one LLM turn at
a time.** Every landmine is now encoded in the scripts. When a run fails:

1. Take ONE screenshot → identify which landmine (list above) → fix ONLY that
   step with a small `browser_run_code_unsafe` snippet → continue. Never
   restart the flow; never fall back to per-click manual driving.
2. The single most destructive bug was clicking a HIDDEN Save button
   (`document.querySelectorAll` without `offsetParent` filter): it submits an
   empty form and silently WIPES another section's saved data. Symptom:
   sections flip between green check and red `*` alternately, and Submit says
   "Please complete all required fields first". Fix: re-open the wiped
   section, re-fill, save via visible-Save only.
3. If a swal click "did nothing", the dialog probably hadn't rendered yet —
   always poll (500ms × up to 10s), never one-shot check.
4. If a section's radios are `disabled` in the DOM, the section is locked
   (already recorded / role-restricted). Do NOT force values and do NOT save —
   SKIP the section and note it in the report. Forcing wrappers around
   disabled radios can silently select the WRONG answer (run 2 saved Opt-In
   "Yes" instead of "No" this way).
5. The browser session may already be logged in from a previous run. Script
   01 handles it: login form → login; no login form → look for "+ Create
   case". If the button never appears the session belongs to a Doctor/other
   role → log out (account icon bottom-left → logout icon in dropdown) and
   re-run script 01, or fix `sale_account` in the JSON.
6. An "overdue cases" swal (Dismiss / Open Case) can appear right after a
   provider-ish login; scripts dismiss it via `.swal-button--cancel`.
7. Expected timing when nothing goes wrong: script 01 ≈ 40–60s, script 02
   ≈ 30–40s, script 03 ≈ 10–20s → total ≈ 1.5–2 min including the two
   AskUserQuestion answers. If a run exceeds ~4 min, stop retrying blindly —
   screenshot and diagnose.

---

## MANUAL MODE (fallback reference only)

The phases below describe the same flow step-by-step. Use them only to debug
or recover a single failed step of fast mode.

## Data source (READ-ONLY)

All patient info and the sale account credentials live in:

```
.claude/skills/test-create-new-case/data/case-data.json
```

- The skill **only reads** this file. It must **NEVER create or regenerate** a
  new JSON file.
- If the file is missing or still contains placeholder values
  (`<SALE_ACCOUNT_EMAIL>` / `<SALE_ACCOUNT_PASSWORD>`) → **STOP** and ask the
  user to fill it in first.
- The `medicare_id` is intentionally NOT in the JSON — it is asked from the
  user on every run (Phase 1).

## Output Language

All user-facing output is in **English**.

---

## Phase 0 — Choose environment

Ask the user with `AskUserQuestion`:

> "Which environment do you want to create the case on?"
> - **dev** → `https://dev-dashboard.dnainsights.ai/#/`
> - **prod** → `https://dashboard.dnainsights.ai/#/`

Record the answer as `<DASHBOARD_URL>`.

---

## Phase 1 — Ask Medicare ID

Ask the user:

> "What is the patient's **medicare_id**? (It will be entered into the
> **Primary Policy #** field, e.g. `8TR2FG1QT15`)"

Record the answer as `<MEDICARE_ID>`. Do not proceed without it.

---

## Phase 2 — Load case data JSON

1. Read `data/case-data.json` (path above).
2. Validate it contains:
   - `sale_account.email` and `sale_account.password` (non-placeholder)
   - `patient.*` fields (first/last name, phone, DOB, state, zip, …)
   - `additional_information.*` (reason of visit, RPM service)
3. If anything required is missing → report exactly what is missing and STOP.
   **Do NOT invent values and do NOT write a new JSON file.**

---

## Phase 3 — Login with the sale account

1. Open the browser (Playwright MCP tools): `browser_navigate` to
   `<DASHBOARD_URL>`.
2. If a login form appears, fill it with `sale_account.email` /
   `sale_account.password` and submit.
3. Wait until the dashboard loads — success looks like the **Task List**
   sidebar with a blue **+ Create case** button and the
   "Welcome back to DNAInsights!" panel.
4. If login fails → screenshot, report the error, STOP.

---

## Phase 4 — Open the New Case form

1. Click the **+ Create case** button (top of the Task List sidebar).
2. Wait for the **\<New Case\>** page with the **Patient Information →
   Eligibility Check** section to render (`browser_snapshot` to confirm).

---

## Phase 5 — Fill Eligibility Check (page 1)

Fill from the JSON (use `browser_fill_form` / `browser_type`; the phone, DOB
and zip inputs are masked — type the values, don't paste via JS):

| Field | JSON source |
|---|---|
| Patient's First Name * | `patient.first_name` |
| Patient's Last Name * | `patient.last_name` |
| Phone Number * | `patient.phone_number` |
| M.I | `patient.middle_initial` (skip if empty) |
| Date of Birth * | `patient.date_of_birth` |
| State * | `patient.state` |
| Zip Code * | `patient.zip_code` |
| Primary Insurance Type * | select the **Medicare** radio |
| Primary Insurance * | `patient.primary_insurance` |
| **Primary Policy # *** | **`<MEDICARE_ID>` from Phase 1** |
| Primary Group # | `patient.primary_group_number` (skip if empty) |

**IMPORTANT — always check the "No Secondary Insurance" checkbox.** This hides
the Secondary Insurance Type / Secondary Insurance fields. Verify via snapshot
that it is checked before continuing.

---

## Phase 6 — Continue

1. Scroll down to the bottom of the form.
2. Click the **Continue** button.
3. Wait for page 2 (**PERSONAL INFORMATION**) to load. First/Last name, DOB,
   Primary Insurance, Primary Policy # appear pre-filled (grayed out) from
   page 1 — do not try to re-enter them.
4. If validation errors block Continue → screenshot, report which fields
   failed, fix from JSON if possible, retry once. Still failing → STOP and ask.

---

## Phase 7 — Fill Personal Information (page 2)

Analyze the JSON and fill every fillable field (snapshot first — pre-filled
gray fields must be skipped):

**PERSONAL INFORMATION**
- Gender * → radio from `patient.gender`
- Ethnicity * → check boxes from `patient.ethnicity` (array)
- **No Secondary Insurance** → verify it is still checked; check it if not
- Social Security Number → `patient.social_security_number` (skip if empty)
- Height (ft.in.) * → `patient.height_ft` / `patient.height_in`
- Weight (lb.) * → `patient.weight_lb` (BMI auto-computes)

**CONTACT INFORMATION**
- Patient's Email Address → `patient.email` (skip if empty)
- Phone Number Types * → radio from `patient.phone_number_type`
- Patient's Phone Number * → pre-filled from page 1; verify only
- Street Address * → `patient.street_address`
- Apt, Suite, etc. → `patient.apt_suite` (skip if empty)
- Zip Code / City / State / Country * → verify pre-filled values; fill from
  JSON if empty (`patient.zip_code`, `patient.city`, `patient.state`,
  `patient.country`)

**ADDITIONAL INFORMATION**
- Reason of Visit * → select `additional_information.reason_of_visit`
- Specify RPM service? * → select `additional_information.rpm_service`
  (appears only after Reason of Visit is set)

---

## Phase 8 — Save each case section

After the case is created it opens in the **case detail** view (header shows
`<Patient Name> [Draft]`, a **Case ID** `CA-…` and **Patient ID** `PT-…`).
The left sidebar lists sections that must each be completed and **saved
individually** (each section has its own **Save** button at the bottom):

> Patient Information → Opt-In Consent → Primary Care Provider → Family History

A section is done when its sidebar entry shows a **green check** ✅ (a red `*`
means still required). If a confirmation dialog **"Are you sure you want to
take this action?"** appears after clicking Save → click **Yes**.

Record the **Case ID** and **Patient ID** from the header for the final report.

### 8a — Patient Information

1. Click **Patient Information** in the sidebar.
2. Most fields are pre-filled (grayed out) from the create wizard. Verify the
   required fields (Gender, Ethnicity, Height/Weight, contact info) match the
   JSON; fill any empty ones from `patient.*`.
3. Scroll down, click **Save**. Wait for the green check on the sidebar entry.

### 8b — Opt-In Consent

Fill from `opt_in_consent` in the JSON:

1. Click **Opt-In Consent** in the sidebar.
2. "Do you give your permission to speak with a licensed telehealth
   provider…?" → select the radio from
   `opt_in_consent.permission_to_speak_with_provider` (Yes/No).
   - Note: the UI warns that answering **No** auto-cancels the case, blocks
     the patient and adds the phone to the DNC registry. Use the JSON value
     as-is (test environment) but include this warning in the final report.
3. **Opt-In Proof** → "Select a consent proof method" → select the radio from
   `opt_in_consent.consent_proof_method`
   (e.g. `Consent proof unavailable at this time`).
4. Click **Save**. Wait for the green check.

### 8c — Primary Care Provider

Fill from `primary_care_provider` in the JSON:

1. Click **Primary Care Provider** in the sidebar.
2. If `primary_care_provider.pcp_information_unavailable` is `true` → check
   **"Primary Care Provider (PCP) information unavailable"**.
3. **Reason for missing info** → select
   `primary_care_provider.reason_for_missing_info` from the dropdown
   (e.g. `Patient does not have an established PCP`).
4. Click **Save**. Wait for the green check.

### 8d — Family History

Fill from `family_history` in the JSON:

1. Click **Family History** in the sidebar.
2. "Do you have any family medical history you would like to note?" → select
   the radio from `family_history.has_family_medical_history` (Yes/No).
   - If `Yes` → add at least 1 family member from
     `family_history.family_members[]`.
3. Click **Save**.

---

## Phase 9 — Submit the case

Only after **all** sections are saved (green checks, no red `*` left):

1. Click the **Submit →** button at the top-right of the case header.
2. A confirmation dialog appears: **"Are you sure you want to take this
   action?"** → click **Yes**.
3. Wait and verify the case status badge changes from **Draft** → **New**
   (the header button becomes **Mark as Pending →**). Take a screenshot.

---

## Phase 10 — Report

```
✅ test-create-new-case done
   Environment:   <dev|prod> (<DASHBOARD_URL>)
   Case ID:       <CA-…>
   Patient ID:    <PT-…>
   Medicare ID:   <MEDICARE_ID> (→ Primary Policy #)
   Patient:       <first_name> <last_name>
   Sections:      Patient Information ✅ / Opt-In Consent ✅ / Primary Care Provider ✅ / Family History ✅
   Status:        Draft → New (submitted & confirmed)
   Logout:        ✅ (sale account logged out, login page verified)
   Data file:     .claude/skills/test-create-new-case/data/case-data.json
   Screenshot:    <path>
```
