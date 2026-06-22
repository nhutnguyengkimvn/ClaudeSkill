# Workflow 04 — Create Order Services Form (Form.io)

> Runs **after Workflow 03 (Flatten + Upload) succeeds**, before the per-recform
> confirmation gate. Builds a Form.io "order services" schema form from the PDF.
> `<DASHBOARD_URL>` = base URL from Phase 0. `<ENV>` = env tag (see below).
> `<PDF_PATH>` = the PDF currently being processed (the validated path from Phase 0).
> Browser steps use the Playwright MCP (`references/playwright-mcp-setup.md`).

## Naming

Form name = `<ENV> [AI] order services <TestType> <Lab>`

- `<ENV>` derived from `<DASHBOARD_URL>`:
  - host contains `dev` or `staging` → `[DEV]`
  - otherwise (production) → `[PROD]`
- `<TestType>` = friendly test-type name matching existing forms' casing
  (e.g. `PGX`, `Immuno`, `Neuro`, `CGx`, `Diabetes`). Match the convention of
  the forms already in the builder list.
- `<Lab>` = Lab name (e.g. `Amedix`).
- `[AI]` tag marks the form as AI-generated (distinguishes from the manually
  created `<ENV> order services <TestType> <Lab>` forms).

Example (dev, PGX, Amedix): `[DEV] [AI] order services PGX Amedix`

## Steps

### 1. Open the Form.io builder
Navigate to: `<DASHBOARD_URL>/admin/formio-dev-builder/`

### 2. Find a reference form (live template)
In the **Forms** search ("Search by name or id…"), type `order services` and
look at the existing forms (e.g. `<ENV> order services CGx Amedix`,
`<ENV> order services PGX Amedix`).
- Open the closest existing form (same/similar test type) and read its
  **Edit Json Schema** to use as the canonical, up-to-date structure.
- Also load `references/order-services-formio-template.json` for the annotated
  skeleton + pattern notes.
- **If the target `<ENV> [AI] order services <TestType> <Lab>` already exists** →
  ask the user whether to edit it or skip (don't blindly overwrite).

### 3. Analyze the PDF & classify fields

> **MANDATORY full read — do NOT build the form from `pypdf` text alone.**
> `scripts/detect-recform-type.py` (pypdf) only extracts the title + lab + page-1
> snippet for Phase 0 type detection. On these forms its text comes out garbled —
> checkboxes render as `q`, ICD-10 codes get split from their labels, and only the
> first panel of page 1 survives the 800-char truncation. It misses tables,
> multi-column layouts, checkbox lists, and gene panels — exactly the content
> Form.io needs. Building the form from that partial text is the main cause of
> missing/garbled fields.

**Step 3a — Read the FULL PDF directly with Claude's `Read` tool.** This is
required, not optional. The `Read` tool renders the PDF visually (all pages), so
it captures every Test Panel, the complete gene list per panel, ICD-10 codes
paired with their labels, all clinical-questionnaire fields, and business-rule
annotations (e.g. "NOT FOR ELDERLY PATIENTS") — none of which survive pypdf.

```
Read(file_path="<PDF_PATH>")
```

- Read the **entire** PDF (every page). Do NOT use gemini/`ai-multimodal` for this
  step — Claude reads the PDF natively and more reliably here.
- **Verify the read is complete**: confirm you captured every Test Panel with its
  full gene list, both Primary and Secondary ICD-10 columns (code + label paired),
  and the Clinical History fields. If anything looks empty or truncated, re-Read
  before continuing. Never proceed on a partial read.

**Step 3b — Inventory & classify.** From the full visual read, inventory
every section. Then load `references/field-taxonomy.md` and classify each
detected field into one of:
- **EMR-prepopulated** — already in the record (patient, provider/clinic,
  payment, specimen, consent). **Do NOT render.**
- **Provider input** — per-order clinical decision. **Render.**
- **Fixed** — the three always-on fields (taxonomy §3). **Always render.**

Apply the **business rules** (taxonomy §2):
- **Medicare-only billing** → drop all payment fields; mark testing-criterion
  (NCCN) + at least one ICD-10/Relevant Diagnosis as **required**.
- **Adults/elderly only** → do **NOT** silently drop whole Test Panels. List any
  age-restricted / pediatric-only panel as **"proposed to drop — AWAITING
  APPROVAL"** in step 4 and drop it **only after the user confirms**; otherwise
  render it. Default = render every Test Panel in the PDF. Pediatric-only options
  *within* a rendered panel may be dropped, but flag each.

Build the **ICD-10 routing map** (taxonomy §4) — per-panel preferred, flat
fallback. This is metadata, **not** a rendered field; the reqform's ICD-10 list
does NOT populate the Relevant Diagnosis options.

### 4. Confirm the field list with the user — BEFORE building JSON
Present a concise, grouped list of the **provider-input + fixed** fields you
intend to generate: label, Form.io type, required/optional, options
(summarized), conditional show/hide logic. In a separate short list, show what
you **excluded** and why (EMR-prepopulated; dropped by a business rule). **Any whole Test Panel you
propose to drop (age-restricted / pediatric, e.g. "NOT FOR ELDERLY PATIENTS")
MUST be listed separately as "proposed to drop — AWAITING APPROVAL" and dropped
only if the user explicitly agrees — never silently. Default is to render every
Test Panel the PDF offers.** Ask the user to confirm or adjust. **Do NOT build
the JSON until they respond.**

#### 4a. MANDATORY label/value confirmation table (Test Panel + Test Parameters)
Before building (or, when editing an existing form, before saving) you **MUST**
show the user an explicit **label / value** table for these two fields so they
can verify and correct the exact strings:

- **`order_service_test_panel`** — every panel option: `label` and `value`.
- **`order_service_test_parameters`** — for **each** panel, the per-panel group
  (`order_service_test_parameters_<N>`): every option's `label` and `value`,
  and which Test Panel value triggers that group (from `customConditional`).

Rules for this table:
- Show `label` and `value` as **separate columns** even when they are equal
  (these forms usually set `value === label`) — the user must be able to spot a
  mismatch.
- Labels frequently contain a literal `|` (e.g. `HFE | PCR — common variants`)
  which breaks Markdown tables; render those rows in a fenced code block (one
  `# | label = value` line per option) instead of a Markdown table so nothing is
  truncated.
- Keep full gene lists verbatim (do not abbreviate the NGS gene strings).
- These `value`s are what the EMR stores on the order and what the aggregator /
  `customConditional` / `validate.custom` expressions match against — a wrong
  value silently breaks panel→parameter wiring, so confirmation is required.

Tell the user they can correct any cell by typing (e.g. "panel 4 value →
`MITOGENOME-360`", or "params_2 option 3 label → …"). **Apply their edits to BOTH
the option `label`/`value` AND every `customConditional` / `validate.custom` /
aggregator `calculateValue` expression that references the changed panel value,
then re-show the table.** Do NOT build/paste/save the JSON until they confirm
this table.

> Source the table from the live schema: for an existing form fetch its **Apis
> to Get Schema** URL (`…/forms/<FORM_ID>/schema.json`) and read
> `order_service_test_panel.data.values[]` + each
> `order_service_test_parameters_<N>.values[]`; for a new form, read it from the
> JSON you are about to build.

### 5. Create a new schema form
Click **Create new schema form**. The editor opens with the dropdown set to
**Edit Json Schema** (raw JSON), with `Save` and `Clone` buttons.

### 6. Build & paste the JSON
From the **confirmed** field list, assemble the Form.io JSON following the
**Component Patterns** below. Set:
- top-level `"name"` = the form name from **Naming** above
- top-level `"display": "form"`
- always include the three **Fixed** fields (taxonomy §3); make **Relevant
  Diagnosis** system-fed (`dataSrc: custom`), never seeded from the reqform list.

Then:
- Paste the assembled JSON into the **Edit Json Schema** editor.
- Use the editor's **Format JSON** if available; make sure it parses (no syntax
  errors).
- **Report to the user**: summarize what was generated (panels, parameters,
  questionnaire fields) and confirm it matches the list approved in step 4.

### 7. Save or revise
- **User says OK** → click **Save**.
- **User says not OK** → apply their requested changes to the JSON, re-paste,
  and ask again. Repeat until approved. Do NOT Save without approval.

### 8. Open the saved form
After Save succeeds, **open the newly created form** so it is loaded and
displayed (as the manually created forms appear when selected):
- In the **Forms** dropdown/search at the top, select
  `<ENV> [AI] order services <TestType> <Lab>` (the form just created).
- Confirm it loads: the **Form Name** header, the **Apis to Get Schema** URL,
  and the builder/JSON for this form are shown.

### 9. Screenshot the rendered form (Preview Form)
For the report's "Create Form.io order services form" step, capture the form
**as it renders**, not the JSON editor:
- Switch the mode dropdown to **Preview Form**.
- **Collapse the dashboard left sidebar FIRST** so the "MAIN MENU" navigation
  panel does not overlap/cover the form. Click the top-left hamburger toggle
  (`#sidebarToggle` on the outer dashboard page — NOT inside the builder iframe).
  Confirm the sidebar is hidden before capturing; otherwise the left portion of
  the form is obscured in the screenshot.
- Capture the **full** form **down to the Submit button** (full-page / full-height
  screenshot, not just the viewport). If the builder is in a cross-origin iframe
  with internal scroll, enlarge the browser window height first (e.g. 1440×2400)
  so the whole form fits, then take a `fullPage` screenshot. Save it as the
  step-6 report screenshot (`06-formio-form.png`).
- The builder's **Edit Json Schema** editor is a **Monaco** editor inside a
  cross-origin `web.app` iframe (no plain textarea/ace). Paste the schema via the
  Monaco model API — `window.monaco.editor.getModels()[0].setValue(<json>)` in
  the iframe frame — then click **Save**. Setting a textarea value will NOT work.

### 10. Link the form schema into the ReqForm metadata
The form's **Apis to Get Schema** URL is what the EMR loads at order time. Wire it
back to the ReqForm created in Workflow 02:
1. Copy the **Apis to Get Schema** URL shown for this form, e.g.
   `https://dev-rce-dashboard.firebaseio.com/forms/<FORM_ID>/schema.json`.
2. Open the ReqForm change page
   (`<DASHBOARD_URL>/admin/ehealth/medicalrecform/?q=<Description>` → open it).
3. Set the **Metadata** field (JSON editor) to exactly:
   ```json
   {
     "list_medication": [
       { "label": "Other", "value": "Other" }
     ],
     "order_form_link": "<SCHEMA_URL>"
   }
   ```
   where `order_form_link` = the schema URL from step 1 (**dynamic** per form).
4. Click **Save**. **No CSV/form sync is needed** for this step.

### 11. Convert Form.io schema to req-form mapping CSV

Use the `convert-order-service-json-to-csv` skill inline — schema URL is already
known from step 8. Do NOT ask the user for the link again.

1. **Fetch the schema JSON** via WebFetch using `<SCHEMA_URL>` (the "Apis to Get Schema"
   URL from step 8). Save the response body to `/tmp/form-<slug>.json`.

2. **First pass** — run the converter:
   ```bash
   ~/.claude/skills/.venv/bin/python3 \
     ~/.claude/skills/convert-order-service-json-to-csv/scripts/convert.py \
     /tmp/form-<slug>.json \
     "<recform-slug>/order-services-<slug>.csv"
   ```
   - Script exits 0 → report `✅ CSV: <recform-slug>/order-services-<slug>.csv (N rows)` and continue.
   - Script exits 2 + `DATAGRID_FOUND` stderr → go to step 3.

3. **Datagrid links (only when DATAGRID_FOUND)** — for each key listed by the script, ask:
   > *"Found datagrid `<key>`. Please provide the JSON link for this field."*
   Re-run with one `--datagrid-link` per datagrid, **in the order the script listed them**:
   ```bash
   ~/.claude/skills/.venv/bin/python3 \
     ~/.claude/skills/convert-order-service-json-to-csv/scripts/convert.py \
     /tmp/form-<slug>.json \
     "<recform-slug>/order-services-<slug>.csv" \
     --datagrid-link "<url1>" [--datagrid-link "<url2>" ...]
   ```

4. Report the CSV path + row count. Then report:
   `✅ Workflow 04 done: Form.io form saved, schema linked, CSV exported.`

---

## Component Patterns (Form.io)

Build the `components` array from these patterns. Keep input keys prefixed
`order_service_`. IDs can be any short unique string. See the annotated
`references/order-services-formio-template.json` for concrete shapes.

1. **Test Panel** — `select`, `key: order_service_test_panel`, `dataSrc: values`,
   `widget: choicesjs`, `required`. `data.values[]` = the panels offered in the PDF.
2. **Placeholder HTML** — `htmlelement`, `key: order_service_html`,
   `customConditional: "show= !data.order_service_test_panel"` (shows hint until a panel is picked).
3. **Test Parameters (per panel)** — one `selectboxes` per panel option,
   `key: order_service_test_parameters_<N>`, `inputType: checkbox`,
   `attributes.data-desc` = panel name,
   `customConditional: "show = data.order_service_test_panel === '<Panel>';"`,
   `validate.custom: "valid = data.order_service_test_panel ==='<Panel>'?true:false;"`,
   `values[]` = the gene/parameter list for that panel.
4. **Aggregator (hidden)** — `hidden`, `key: order_service_test_parameters`,
   `redrawOn: data`, `calculateValue` = a ternary chain mapping each panel to its
   matching `order_service_test_parameters_<N>`. One arm per panel.
5. **Section header HTML** — `htmlelement` with a styled `<div>` (e.g. "Clinical
   Assessment Questionnaire").
6. **Cancer/condition diagnosis** — `select` `multiple: true`,
   `key: order_service_patient_s_personal_cancer_diagnosis`, values from the PDF's
   diagnosis checklist.
7. **Conditional follow-ups** — `radio`/`textfield` shown via `conditional`
   (`when`/`eq`/`show`) on a parent answer (e.g. laterality when "Breast Cancer",
   "Specify other malignancy" when "Other malignancy").
8. **Free-text clinical fields** — `textfield` (Age of Primary Diagnosis,
   Stage/Grade), `datetime` (Date of diagnosis, `format: MM/dd/YYYY`).
9. **Family history** — `select` `multiple: true` with the PDF's hereditary
   pattern list.
10. **Guideline criteria** — `select` `multiple: true` (e.g. NCCN criteria) +
    a conditional `textfield` to cite "Other …" when chosen.
11. **Medications datagrid** (PGx-type forms) — `datagrid`
    `key: test_requirements_test_order_medication`, often `hidden: true`,
    containing a nested `container` with a `select` (`dataSrc: url`,
    `url: /ehealth/medications/?recform_id={{recform_id}}`) + a conditional "Other"
    textfield, plus a `usage` selectboxes (Current/Future).
12. **Additional Clinical Context** — `textfield`,
    `key: order_service_additional_clinical_context`.
13. **Relevant Diagnosis** — `select` `multiple: true`, `dataSrc: custom`
    pulling from `window.currentCase?.case_data?.rawjson?.diagnosis_icd10codes`.
14. **Instructions** — `textarea`, `key: order_service_instructions`.
15. **Submit** — `button` `action: submit`, `key: submit`.

> Not every PDF has every section. Include only what the PDF supports; always
> include Test Panel + its Test Parameters + aggregator + Submit, plus the three
> **Fixed** fields from `references/field-taxonomy.md` §3 (Additional Clinical
> Context #12, Relevant Diagnosis #13, Instructions #14). When unsure how a field
> should look, copy the shape from the reference form opened in step 2.
