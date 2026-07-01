---
name: verify-formio-panel-params
description: >
  Verifies the Form.io order-services Test Panel → Test Parameters → aggregator
  wiring for a lab order form. Runs a static key/wiring check on the schema JSON
  (every order_service_test_panel option maps to exactly one
  order_service_test_parameters_<N> group and one matching aggregator arm), then
  optionally drives the live Preview Form to confirm that selecting a panel and
  its parameters actually populates the hidden order_service_test_parameters in
  the Submission JSON. Called from import-lab-recform W04 after the form is
  saved, or standalone. Use when the user says "check the formio form", "verify
  panel parameters", "kiểm tra panel/parameters", or "chọn panel rồi chọn hết
  xem có data không".
---

# Verify Form.io Panel → Parameters Wiring

Confirms the panel/parameters/copy mechanism of an order-services Form.io form is
correct — the exact thing that silently breaks when a key or panel-value string
is wrong.

## The mechanism being verified

```
order_service_test_panel            (select, one value per panel)
   │  user picks a panel value
   ▼
order_service_test_parameters_<N>   (selectboxes, one group per panel)
   │  customConditional: show = data.order_service_test_panel === '<Panel>'
   │  validate.custom  : valid = data.order_service_test_panel === '<Panel>' ? true : false
   │  user checks the gene/parameter options
   ▼
order_service_test_parameters       (hidden aggregator)
      calculateValue ternary: for each panel value, copy the matching
      order_service_test_parameters_<N> into this single field.
```

A wrong panel string (option vs. `customConditional` vs. aggregator arm), a
missing/duplicate group, an empty `values[]`, or an aggregator arm pointing at
the wrong `_<N>` all break the copy silently — the form renders but
`order_service_test_parameters` stays empty in the submission. This skill catches
exactly those.

## Invocation

```
verify-formio-panel-params <schema.json | schema-url> [--dashboard <url>] [--live]
```

- `<schema.json | schema-url>` — the Form.io schema. A local JSON file, or an
  "Apis to Get Schema" URL (`…/forms/<FORM_ID>/schema.json`) — fetch the URL to
  `/tmp/form-check.json` first (WebFetch), then run the check on the file.
- `--live` — also run the browser Preview-Form check (Phase B). Requires the
  Playwright MCP logged in to the dashboard (see
  `import-lab-recform/references/playwright-mcp-setup.md`).

When called from **import-lab-recform W04**, `<SCHEMA_URL>` and `<DASHBOARD_URL>`
are already known — skip straight to Phase A, then Phase B.

## Output Language

All user-facing output is in **English**, regardless of conversation language.

---

## Phase A — Static wiring check (always run)

```bash
python3 .claude/skills/verify-formio-panel-params/scripts/validate_panel_wiring.py \
  <schema.json>
```

The script prints a per-panel table (panel value → group `_<N>` (opt count) →
aggregator arm) then a verdict:

- **`✅ PASS`** (exit 0) — every panel option has exactly one parameters group
  whose `customConditional` and `validate.custom` reference the same panel value,
  a non-empty `values[]`, and an aggregator arm pointing at that same `_<N>`.
- **`❌ FAIL`** (exit 1) — one or more issues, each printed as a line. Common
  causes: panel-value typo, missing/duplicate group, empty `values[]`, aggregator
  arm missing or pointing at the wrong `_<N>`.

**If FAIL:** report the exact issues to the user and (in W04) fix the schema JSON
before saving — do NOT save/paste a form that fails Phase A. The listed panel
value is the string to correct across the option `value`, the group's
`customConditional`, its `validate.custom`, and the aggregator arm — all four
must be byte-identical.

> The check reads keys structurally, so it works on any order-services form, not
> just NEURO — the key names (`order_service_test_panel`,
> `order_service_test_parameters`, `order_service_test_parameters_<N>`) are the
> contract every such form must follow.

---

## Phase B — Live Preview check (when `--live`, or from W04)

Drives the saved form in **Preview Form** via the Playwright MCP to confirm the
copy actually fires at runtime. Do this **after** the form is saved and opened
(W04 step 8).

1. In the builder, switch the mode dropdown to **Preview Form**. Also switch a
   second view to **as Submission JSON** if the builder shows it side-by-side
   (as in the dashboard preview); otherwise read the submission via
   `browser_evaluate` on the Form.io instance.
2. For **each** panel value (iterate all of them — do not sample):
   a. Open the **Test Panel** `choicesjs` dropdown, type to filter, click the
      option.
   b. `browser_snapshot` → confirm the matching **Test Parameters** selectboxes
      group is now visible and lists options (not the "Gene parameters will
      appear here…" placeholder).
   c. Check **all** options in that group (`browser_click` each checkbox).
   d. Read the Submission JSON and assert:
      - `order_service_test_parameters` is **non-empty** (an object with the
        checked option(s) set to `true`), and
      - it equals the currently-visible `order_service_test_parameters_<N>` value.
   e. Record `✅`/`❌` for this panel, then clear the selection (or re-select the
      next panel — `clearOnHide` resets the previous group).
3. A panel **fails** if its group does not appear, shows no options, or leaves
   `order_service_test_parameters` empty after all boxes are checked.

> Reading the submission programmatically is more reliable than OCR-ing the
> panel: `browser_evaluate` → return the Form.io instance `submission.data`
> (`Formio.forms` / the form root element's `.formioComponent.data`), then inspect
> `order_service_test_parameters`.

---

## Report

```
Form: [DEV] [AI] order services NEURO Alpha Dera
Phase A (static): ✅ PASS — 15/15 panels wired (or ❌ with the issue list)
Phase B (live):   ✅ 15/15 panels populate order_service_test_parameters
                  (or list the failing panels)
```

If either phase fails, list the failing panel value(s) and the exact fix
(the string/key to correct). Do not report the form as verified unless Phase A
passes; when run with `--live`/from W04, Phase B must also pass.
