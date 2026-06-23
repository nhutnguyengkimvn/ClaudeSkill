---
name: import-key-to-pdf
description: >
  Fills the AnnotsJSON field of a PDF record in the DNA Insights medicalpdf admin.
  Reads the current AnnotsJSON from the dashboard, uses icd10-panel-fill to map
  each annotation's UUID to the correct ICD10 panel string (by reading the source PDF),
  then pastes the updated JSON back into the AnnotsJSON field and saves.
  Invoked as `import-key-to-pdf <path.pdf> [<dashboard_url>]`, or called inline
  from import-lab-recform after W04.
---

# Import Key to PDF

Fills the **AnnotsJSON** field of a PDF record in
`<DASHBOARD_URL>/admin/ehealth/medicalpdf/` by analyzing the source PDF with the
`icd10-panel-fill` skill and writing the enriched annotation JSON back to the
dashboard.

## Invocation

```
import-key-to-pdf <path.pdf> [<dashboard_url>]
```

- `<path.pdf>` — absolute path to the source lab PDF (same file used in W03).
- `<dashboard_url>` — optional; if omitted, ask the user.

When called from **import-lab-recform**, `<PDF_PATH>` and `<DASHBOARD_URL>` are
already set — skip Phase 0 and go straight to Step 1.

## Output Language

**All user-facing output is in English**, regardless of conversation language.

---

## Phase 0 — Validate Inputs (standalone only)

1. Check `<path.pdf>` was supplied; if missing → `❌ No PDF path supplied.` STOP.
2. Validate path exists and ends with `.pdf`; if invalid → `❌ Invalid path: <path>` STOP.
3. If `<dashboard_url>` not supplied, ask:
   ```
   Dashboard base URL? (e.g. https://dev-dashboard.dnainsights.ai)
   ```
4. Ensure Playwright MCP browser is ready and logged in to `<DASHBOARD_URL>/admin/`.

---

## Step 1 — Fetch current AnnotsJSON from dashboard

1. Navigate to: `<DASHBOARD_URL>/admin/ehealth/medicalpdf/`
2. Search for the PDF entry that matches the current recform
   (search by the flattened filename or Description, e.g. `CGX - Amedix <YEAR>`).
3. Click on the matching entry to open its change page.
4. Read the current value of the **AnnotsJSON** field.
   - If the field is empty → report `⚠️ AnnotsJSON is empty. Nothing to fill.` and STOP.
5. Save the raw JSON value to `/tmp/annots-<recform-slug>.json`.
6. Report: `✅ Fetched AnnotsJSON (N annotation objects)`

---

## Step 2 — Analyze PDF and build ICD10 panel mapping

> **Goal:** produce `{ "<uuid>": "diagnosis_icd10codes_panel_<Panel>__<ICD>" }` for
> every annotation whose `contents` looks like `diagnosis_icd10codes__<ICD>`.

1. Read the full PDF with Claude `Read` tool (`<PDF_PATH>`). Do NOT use pypdf.
   Confirm all pages captured (panels, ICD-10 code lists, panel headers).

2. Load the AnnotsJSON from `/tmp/annots-<recform-slug>.json`.
   Identify annotation objects where `contents` matches the pattern
   `diagnosis_icd10codes__<ICD>` (short form, no panel prefix).

3. For each such annotation:
   - Extract `<ICD>` from `contents`.
   - From the PDF content, determine which **panel** owns that ICD code
     (the panel whose code list contains `<ICD>`).
   - Build the full value: `diagnosis_icd10codes_panel_<Panel>__<ICD>`.
   - Record: `{ "<uuid>": "diagnosis_icd10codes_panel_<Panel>__<ICD>" }`.

4. Save the mapping to `/tmp/icd_map.json`.

5. If any ICD code cannot be matched to a panel in the PDF:
   - List them as **unresolved** and ask the user to confirm the panel name before continuing.

6. Show the user a compact confirmation table:
   ```
   UUID (first 8 chars)  | contents (before)                    | value (after)
   ─────────────────────────────────────────────────────────────────────────────
   a1b2c3d4              | diagnosis_icd10codes__C50.0           | diagnosis_icd10codes_panel_Breast Cancer__C50.0
   ...
   ```
   Ask: **"Apply this mapping? (yes / adjust)"**
   Do NOT proceed to Step 3 until confirmed.

---

## Step 3 — Apply mapping via icd10-panel-fill

Use the `icd10-panel-fill` skill inline:

- Mapping file: `/tmp/icd_map.json`
- Target file: `/tmp/annots-<recform-slug>.json`

Follow the icd10-panel-fill steps exactly:
1. Dry-run check (confirm UUID matches + count changes).
2. Backup target file as `/tmp/annots-<recform-slug>.json.bak`.
3. Apply → verify.
4. Report: `✅ icd10-panel-fill: N changed, M skipped`

---

## Step 4 — Paste updated AnnotsJSON into dashboard and save

1. Navigate back to the medicalpdf change page for this PDF
   (`<DASHBOARD_URL>/admin/ehealth/medicalpdf/` → search → open entry).
2. Clear the **AnnotsJSON** field.
3. Paste the full contents of `/tmp/annots-<recform-slug>.json` into the field.
4. Click **Save**.
5. Wait for the success confirmation page.
6. Take a screenshot: `<recform-slug>/screenshots/<NN>-annots-json-saved.png`.
7. Report: `✅ import-key-to-pdf done: AnnotsJSON updated and saved.`

---

## Final Report Format (standalone)

```
PDF:        CGX rec_Amedix-flatten-pdf.pdf
Dashboard:  https://dev-dashboard.dnainsights.ai
Annotations fetched:  42
Panel mappings built: 38  (4 unresolved — listed above)
icd10-panel-fill:     38 changed, 0 skipped
AnnotsJSON saved:     ✅
```
