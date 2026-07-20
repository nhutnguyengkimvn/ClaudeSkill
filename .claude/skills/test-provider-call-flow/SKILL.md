---
name: test-provider-call-flow
description: >
  Step 3 of the DNA Insights core test flow — the provider consult call. Runs
  TWO parallel logins (PSS in the default browser context, PROVIDER in a
  second isolated context): PSS opens the Pending case, starts the call
  overlay, calls the patient mobile (patient number 804-222-1111 auto-answers
  on dev), then rings provider "DR VU Doctor"; the provider answers the
  pop-call, opens the case from the call widget, and a script completes the
  provider sections (Medications, Medical History, Review of Systems, Family
  History, General Health, Depression Screening, Social History, Preventive
  Screening, Functional Status & Safety, Advance Care Planning), creates
  Orders via Manage Orders, adds a Care Plan item, saves Diagnosis, and waits
  for the Master Encounter Report to generate. Case ID comes from report.json
  (or asked when standalone). Invoked as `test-provider-call-flow`.
---

# Test — Provider Call Flow (PSS + PROVIDER, dual session)

Continues after `/test-submit-case-to-pending`: the PSS calls the patient and
the provider, the provider answers and completes the clinical encounter.

## Accounts & data

- **PSS**: from `../test-submit-case-to-pending/data/pss-data.json` (session
  is usually still logged in — that skill does not log out).
- **PROVIDER**: `data/provider-data.json` → `provider_account`
  (`vu.bui.provider@gkim.vn`). Section answer sets + fabricated clinical data
  also live in `provider-data.json`; keys captured on calibration runs are in
  `data/captured-keys.json`.
- **Patient phone** must be `804-222-1111` (test number that answers) — set
  in test-create-new-case's case-data.json since 2026-07-13.

## Inputs & environment rule (same as the other sub-skills)

- **From `/test-core-flow`**: ask nothing — `environment` + `case_id` come
  from `state/report.json` (case must be **Pending**).
- **Standalone**: ask environment (dev/prod) + case ID in ONE
  AskUserQuestion call (recommend the report.json case when env matches).

## Dual-session mechanics (IMPORTANT)

- The Playwright MCP `page` = PSS session (default context).
- The PROVIDER runs in a SECOND, isolated browser context created inside
  `browser_run_code_unsafe`:
  `const provCtx = await page.context().browser().newContext(); const provPage = await provCtx.newPage();`
- Re-acquire it in later calls:
  `const provCtx = page.context().browser().contexts().find(c => c !== page.context()); const provPage = provCtx.pages()[0];`
- Grant mic permission on BOTH contexts before any call:
  `ctx.grantPermissions(['microphone'], { origin: '<dashboard origin>' })`.
  (The macOS system mic prompt cannot be automated — it must already be
  allowed once manually.)

## ⚡ FAST MODE (default — target 3-5 min)

Run the pre-built scripts via `mcp__playwright__browser_run_code_unsafe`
(4 calls). READ `data/captured-keys.json` if any selector needs adjusting.

> Why 01 is split in two: goto/reload on the provider page KILLS the presence
> websocket → row shows Offline, no Call button, no pop. Retrying the call
> must re-run **01b only** — never re-navigate the provider page.

1. **Read `scripts/prov-01a-dual-login-online.js`**, replace `__CONFIG__` with
   `{ url, pssEmail, pssPassword, provEmail, provPassword, caseId }` → run.
   Logs both sessions in (SKIPS goto/login when a session is already alive,
   handles wrong-role sessions + stray tabs), PSS opens the case + the call
   overlay, then POLLS (≤90s) until "DR VU Doctor" shows **Online**.
   Returns `{ cid, providerLoggedIn, providerOnline }`. If Online never
   shows: wait and re-run 01a — do NOT reload the provider page by hand.
2. **Read `scripts/prov-01b-call-answer-open-case.js`**, replace `__CONFIG__`
   with `{ url, caseId, cid }` (cid from 01a) → run. The CALL SEQUENCE
   (order confirmed by the user):
   **(1) call the PATIENT** (Call Mobile → 804-222-1111 answers) →
   **(2) the MOMENT it connects, ring the provider** (row Call button →
   dropdown → **Voice**) — zero pause, the test line drops after ~30-60s →
   **(3) switch to the provider context and answer the pop IMMEDIATELY**
   (green button — answering is what ASSIGNS the Pending case) →
   **(4) poll the CA-link every 5s** (≤45s) until the case opens (fallback:
   cid URL, only AFTER answering). Returns
   `{ patientCall, providerRung, popShown, providerCaseOpen }`.
   On failure re-run 01b ONLY.
3. **Run `scripts/prov-02-fill-sections.js`** via `{ filename }` (no
   placeholders — answers are baked in from provider-data.json). Fills and
   activity-log-verifies all 10 sections + Diagnosis (Z00.01) using the
   exact captured field keys.
4. **Run `scripts/prov-03-orders-plan-mer.js`** via `{ filename }`. Creates
   every remaining order in Manage Orders (loops the exact-'Order' buttons;
   CGM consent path; avoids CUSTOM panels and Breast CGX options), adds the
   Care Plan item + Discussion Notes, saves A&P, then generates the Master
   Encounter Report and waits (≤3 min).

Then merge results into `state/report.json` and report. Both sessions stay
logged in. On failure: ONE screenshot → fix only the failing step (all known
landmines are listed below and in captured-keys.json).

## Flow (reference)

1. **PSS side (default context):** ensure logged in as PSS (role check "Call
   Scoring") — login if needed. Search + open the case (trusted click on
   `.gk-cases-wrapper`), verify Case ID.
2. **Provider side (second context):** login `vu.bui.provider@gkim.vn` →
   Doctor dashboard ("+ Busy Time"). Leave it idle; being online makes
   "DR VU Doctor" show **Online** in the PSS call overlay.
3. **PSS:** click the phone icon in the case header → call overlay opens
   (patient card + "Call Mobile" + provider list on the right).
4. **PSS:** click **Call Mobile** → PSTN call to 804-222-1111 → wait until
   the timer runs (patient auto-answers).
5. **PSS:** in the provider list, click **Call** on the "DR VU Doctor" row
   (row shows Online thanks to step 2).
6. **PROVIDER:** the pop-call appears (patient + case info, red/green
   buttons) → click the GREEN button to answer.
7. **PROVIDER:** the mini call widget shows the `CA-…` link → click it →
   Task List opens searching `PT-…` → wait, then trusted-click the case card.
8. **PROVIDER — fill sections** (each saved + verified via activity log,
   same landmine rules as the other skills; disabled → skip):
   Medications → Medical History → Review of Systems → Family History →
   General Health → Depression Screening → Social History → Preventive
   Screening and Immunization → Functional Status & Safety → Advance Care
   Planning. Answers from `provider-data.json`; unknown questions use the
   generic strategy and get captured into `captured-keys.json`.
9. **PROVIDER — Assessment & Plan:** click **Manage Orders** → create ONE
   order per available service (PGx, Neuro, Immuno, Diabetes, Metabolic,
   CGX, CGM/BGM — capture every order form's fields on calibration) → close →
   **Add Plan Item** (Problem = a diagnosed ICD-10, Type/Status/Plan/Goals
   from data) → fill Discussion Notes → **Save**.
10. **PROVIDER — Diagnosis:** pick the REQUIRED Z-code chip(s) (Z00.01) →
    **Save**.
11. **PROVIDER — Master Encounter Report:** open the section, WAIT for the
    report to finish generating (poll until the spinner/generating text is
    gone), screenshot, and report the result. No data entry.
12. Merge results into `state/report.json`
    (`steps["test-provider-call-flow"]`), leave both sessions logged in and
    the call running unless told otherwise, and print the report.

> The flow continues past this point (user will specify later steps —
> ending the call, approving the case, …). Do NOT invent them.

## Calibration status: DONE 2026-07-13 (case CA-VOWXT6JN)

All selectors/keys are recorded in `data/captured-keys.json` — READ IT before
driving anything. Top lessons (also see captured-keys.json):

- **CALL SEQUENCE IS MANDATORY AND ORDERED** (user-confirmed): patient call
  FIRST → the moment it connects, ring the provider (Call → **Voice** in the
  dropdown) with ZERO pause → provider ANSWERS the pop right away → poll the
  CA-link (assignment lands within ~10-45s) → provider opens the case.
  Answering the pop IS the assignment step: the URL-cid trick alone only
  works on cases ALREADY assigned; on a fresh Pending case it silently falls
  back to the Task List and the PSS "Assign" header button stays DISABLED.
- **Presence dies on navigation**: ANY goto/reload on the provider page kills
  the websocket → row shows Offline, Call button never appears, pop never
  arrives. This is why 01 is split: 01a (login + wait Online) vs 01b (call);
  failed calls retry 01b only. The old monolithic prov-01 re-goto'd the
  provider page on every retry — that was the 2026-07-13 "stuck forever" bug.
- The provider Call button (`button.rf-btn-call-single`) opens a
  **Voice/Video dropdown** — pick **Voice**. It only appears while the row
  shows **Online**, and only from inside the live patient call.
- The pop DOES arrive in Playwright Chromium (websocket, not FCM) — but only
  when the provider page sits STABLE on the dashboard (no reload/goto around
  ring time; navigation kills the socket). Poll ~25s, answer via the green
  fa-phone button.
- 'Call Mobile' DISAPPEARS once the patient call is ringing — check in-call
  markers ('Switch to Digital' / 'Patient: +1' / timer) before re-clicking;
  a blind re-click throws. testcall.com can be briefly busy — one 15s
  backoff retry.
- SPA quirk: after opening a case, the URL may stay `#/` (no cid) — capture
  the cid from step 1's post-save URL and carry it in report.json instead of
  re-reading the PSS URL.
- The PSS Task List card can sit UNDER the nav sidebar (negative x in its
  bounding box) — trusted clicks get intercepted. Most reliable: search
  first, then click the card's RIGHT side by coordinates, or avoid the click
  entirely by navigating with the known cid.
- The testcall.com patient number answers then DROPS after ~30-60s → ring the
  provider IMMEDIATELY while the patient call timer is running.
- One patient = ONE active Wellness case: `test-create-new-case` gets blocked
  with "An active Wellness case already exists" while a previous case is
  open — reuse the active case instead of creating one.
- Order forms: Choices selects have LAZY options → TRUSTED Playwright clicks
  only (JS clicks silently do nothing); placeholder items carry the
  `choices__placeholder` class (a select LOOKS filled but isn't); pick
  NON-"CUSTOM PANEL" test panels; CGM/BGM has a 3-checkbox consent step
  first; CGX breast options spawn a required laterality field.
- Other tabs on the dashboard origin resurrect a cleared session — close
  them before switching accounts; a `beforeunload` dialog can also appear
  when leaving an unsaved New Case (auto-accept dialogs via page.on).
- All landmine rules from the other two skills still apply (visible Save
  only, JS-click + poll swal, Form.io radios by input value, activity-log
  save verification, badge-zone status reads).

## Report

```
✅ test-provider-call-flow done
   Environment:   <dev|prod>
   Case ID:       <CA-…> (verified)
   Call:          patient 804-222-1111 answered ✅ / provider answered ✅
   Sections:      <list with ✅/⏭>
   Orders:        <n> created via Manage Orders
   Care Plan:     added ✅ / Diagnosis saved ✅
   Master Encounter Report: generated ✅
   Sessions:      PSS + PROVIDER both still logged in, call still active
   Report file:   .claude/skills/test-core-flow/state/report.json
```
