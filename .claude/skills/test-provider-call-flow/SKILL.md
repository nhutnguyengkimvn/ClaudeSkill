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
4. **Run `scripts/prov-03b-ap-notes-mdm-mer.js`** via `{ filename }` — the
   DEFAULT finish: closes any leftover order modal, fills A&P Discussion Notes +
   MDM by exact field name, saves, then generates the Master Encounter Report
   and waits for the section marker to go green (≤3 min). No Manage Orders.
   Use `scripts/prov-03-orders-plan-mer.js` INSTEAD only when the user
   explicitly wants orders automated (see the Orders section below for why it
   is slow and fragile).

**SPEED RULE (2026-07-30 feedback — the run felt slow):** never
`waitForTimeout` for something observable. Every script now carries an
`until(fn, timeoutMs, everyMs)` poll helper; section switches went from a fixed
2s each to 15–230ms measured (6 sections: 12.0s of sleeps → 0.6s). Other rules:
poll role/nav checks at 200ms, not 1s; race the save-confirm dialog against the
activity log instead of burning a fixed 3s per section on a dialog that never
appears; and only `reload()` when the SPA is already mounted on a hash route.
When adding code here, keep sleeps out.

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

## Entry point when the case is ALREADY Assigned — `prov-01c` (added 2026-07-30)

When the call was made outside this run (user called manually) or the case
auto-assigned, run **`scripts/prov-01c-open-assigned-case.js`** with
`{ url, provEmail, provPassword, caseId, cid }` INSTEAD of 01a + 01b: it logs
the provider into the second context and opens the case, no call sequence, no
presence websocket. Then continue with prov-02 (and prov-03 if orders are
wanted). Check the header badge first — `Assigned` means take this path.

## Orders: the user usually does Manage Orders manually (2026-07-30)

Creating orders through the form is slow and brittle; on 2026-07-30 the user
asked to **skip the Manage Orders automation entirely** and did the orders +
Sign Off by hand. Treat prov-03's order loop as opt-in, not default: fill
A&P/MER and let the user handle orders unless they ask otherwise. Known order-
form landmines if it is ever needed again:

- **Lab is a react-select (`#order-form-lab-select`, `.sp-select__control`), not
  a formio Choices** — and ~17 `.sp-select__control` nodes exist page-wide, so
  `.first()` grabs the sidebar's status select and times out. Click it by
  coordinates inside the modal instead, then type the lab name + Enter.
- **The default lab "Alpha Dera" has NO Test Panel options for PGx on dev** —
  Save then fails forever with "Test Panel is required". Switching the lab to
  **Knucks** loads panels (Comprehensive / Psych) AND re-renders the whole form
  with different fields (Reason for Exam, Medications for PGx Review grid), so
  every field must be re-read after a lab switch.
- **Relevant Diagnosis is required** on the Alpha Dera PGx form (multi Choices,
  option = the case's Z00.01) — prov-03 explicitly skips that label, which is
  why its only order attempt failed.

## Calibration status: DONE 2026-07-13 (case CA-VOWXT6JN)

All selectors/keys are recorded in `data/captured-keys.json` — READ IT before
driving anything. Top lessons (also see captured-keys.json):

- **A section body can hang on "Loading… ⟳" — bounce, don't wait** (user-reported
  2026-08-07): the heading renders before the body mounts, and the body can stick
  on `Loading... ⟳` forever. Waiting longer never resolves it — every input poll
  reads an EMPTY form and the section is falsely reported as failed/incomplete.
  **Rule: if the body is still "Loading…" after ~2s, click another sidebar
  section, wait ~1s, click back** — the remount loads instantly. `clickSection()`
  in prov-02 now does this automatically (3 bounce attempts).
- **Ticking a Form.io checkbox needs THREE things at once** (2026-07-30 — this
  single bug cost five repair rounds on CA-QI3GSKRF): `scrollIntoView` (the
  attestation boxes sit ~1500px down, outside the 1000px viewport, so a click
  lands on nothing), click the **LABEL** (`label.form-check-label`; the input is
  `opacity: 0`), and **verify `.checked`** afterwards — a JS `el.click()` flips
  the property but Form.io never registers it, so the value reverts on the next
  re-render. `preventive_exam_statement` came back unchecked that way after a
  "successful" tick and silently blocked the section's Save (button greyed out,
  "Please check the form and correct all errors").
- **Diagnosis Z-codes are `<div class="tag">` pills** inside `.essentials`, and
  the list LAZY-LOADS ("Loading..." first). A trusted locator click sets
  `class="tag active"` and clears "Z Code for Wellness is REQUIRED". A JS click
  or a coordinate click does nothing — and the switch on the right of that row is
  a "Description" toggle, not the selector.
- **`svg.gk-section-valid-icon` is the ERROR icon, not the valid one** (2026-07-30):
  it wraps `id="icon-error"` and renders the RED `*` of an INCOMPLETE section. A
  COMPLETE section renders a green circle `fill="#227110"`. Read completeness from
  `.card-header strong` → parent `outerHTML`; scope to `.card-header` or a stray
  duplicate `<strong>` elsewhere on the page flips the answer.
- **Never scan the active form for missing fields AFTER Save** (2026-07-30): the
  app AUTO-ADVANCES to the next section, so the scan reports the *next* section's
  empty fields and every section looks "saved-INCOMPLETE". Scan before Save;
  judge completeness from the sidebar marker.
- **The ROS attestation must be ticked BY NAME** (2026-07-30):
  `checkBoxesByText()` matches `cb.closest('.formio-component, label, div')`,
  which resolves to the innermost wrapper div — it does NOT contain the label
  text, so the box was silently never ticked. Use
  `input[name="data[review_of_system_confirm]"]` + trusted `check()`.
- **Family History must be answered "No"** (2026-07-30): the form renders FIVE
  member blocks and Condition (2)–(5) are all required, so the old "Yes + Mother
  /Cancer" path can never complete the section. "No" also matches what SALES
  saved in case-data.json.
- **A green activity-log entry does NOT mean the section is COMPLETE**
  (2026-07-27): "updated the case on <Section>" is logged even when required
  fields are still empty and the sidebar keeps a red `*`. prov-02's `doSection`
  now also scans the active section for required-but-empty fields and reports
  `saved-INCOMPLETE: <labels>`. Two sections were hit by this:
  - **Review of Systems**: the blocking field is the attestation box
    `data[review_of_system_confirm]` ("I affirm that i have verified…"), not
    "I have checked this section". The 10 body-system groups show a `*` but do
    NOT block completion — do not fabricate symptoms; only "No Lesions"
    (Dermatologic) is a genuine negative finding.
  - **Family History**: Relation to Patient (1) / Living or Deceased (1) /
    Maternal-Paternal side must be set with LABEL-SCOPED trusted clicks; the
    old document-wide JS scan matched nothing and left the section incomplete.
- **A case can already be Assigned to the provider without any call** (e.g.
  auto-assignment after Pending). When the provider's Task List already shows
  the case as **Assigned**, the sections can be reached directly and the whole
  call sequence is unnecessary. Verify the badge before deciding to call.
- **Switching the provider to another case needs a real `page.reload()`** —
  `goto()` on a `#/?cid=…` hash URL does not re-render the SPA, so the previous
  case stays on screen (and a "Document Review & Sign off" modal can block
  clicks). Close the modal, then goto + reload. Only safe when the call is not
  in play — navigation kills the presence websocket.
- **CALL-OVERLAY UI MAP** (user screenshots 2026-08-07 — the authoritative one):
  1. Case header phone icon → overlay. LEFT = patient card (avatar, name, address,
     `(804) 222-1111`, `DNA Insights`) with **[Call Mobile |v]** and
     **[Send Invite |v]**; RIGHT = provider list: *"No dedicated providers with
     matching states"*, **MATCHING STATES: (1 provider)**, **Ring selected
     Providers**, *Select all*, and the row **DR VU Doctor / 8 States** with a
     presence badge. Bottom bar: Reschedule / Open Case / Call History / Mic /
     Camera / **Leave call**.
  2. **Start the patient call via the CARET next to Call Mobile** → menu
     `Call Mobile` / `Call Landline` (disabled) / `Open Dialer` → pick
     **Call Mobile**.
  3. Ringing screen = `+1 804 222 1111` + **"Calling..."**.
  4. Connected = timer **`00:17/ 20 mins`**, waveform, **Switch to Digital**,
     bottom-left **`Patient: +1 804 222 1111`**.
  5. **Ring the provider: CLICK the DR VU Doctor row** (on the name area, not the
     leading checkbox) → the row highlights and **`Call`** appears on its right →
     click `Call` → menu `Voice` / `Video` → pick **Voice**.
     - Hovering alone is NOT enough — the row must be CLICKED (user-corrected
       2026-08-07).
     - The blue **`Ring selected Providers`** button is NOT this path: pressing it
       with no provider ticked only pops **"Please select provider to call list"**
       with a **`Got it`** button. prov-01b clears that dialog and treats it as a
       hard failure of the row selection rather than retrying blindly.
  6. Provider side: pop card `PSTN Call` / `PSS` / `VU PSS` / `Patient ID: PT-…`
     / `Case ID: CA-…` / Service / Reason of Visit, with a RED and a GREEN round
     button → click the **GREEN** one to answer.
- **"Offline" DOES NOT BLOCK THE CALL** (corrected 2026-08-07): the row's `Call`
  button is hover-revealed and works while the badge reads **Offline**, and the
  pop still arrives. The old prov-01a gated on an `Online` badge, polled 90s,
  never saw it and aborted — that was the "BLOCKED at ring-provider" failure.
  Presence is now recorded as `providerPresence` for information only; 01a waits
  only for the ROW to exist. Never re-add an Online gate.
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
