# Workflow 05 — Generate & Enrich AnnotsJSON

> Runs **after Workflow 04 (Create Form.io Order Services Form) succeeds**.
> Inherits `<DASHBOARD_URL>`, `<PDF_PATH>`, `<MEDICALPDF_ID>`, and
> `<recform-slug>` from the current pipeline run.

## Step 1 — Fetch current AnnotsJSON

1. Navigate to: `<DASHBOARD_URL>/admin/ehealth/medicalpdf/<MEDICALPDF_ID>/change/`
2. Read the **AnnotsJSON** Ace editor field value.
3. If **non-empty** → save to `/tmp/annots-<recform-slug>.json`, report
   `✅ AnnotsJSON fetched (N annotation objects)`, and skip to **Step 3**.
4. If **empty / null** → report
   `⚠️ AnnotsJSON is empty. Running generate-annots-json to create it.`
   Continue to **Step 2**.

---

## Step 2 — Generate AnnotsJSON (when empty)

Invoke the `generate-annots-json` skill inline:

```
generate-annots-json <PDF_PATH> [--key <key.json>]
```

> The skill runs Steps 1b–5 (generate key.json if needed → detect → assign →
> form-key-verifier → save JSON file). See
> `.claude/skills/generate-annots-json/SKILL.md` for full steps.

After the skill completes, it saves `annots-<recform-slug>.json` to the
project folder and instructs the user to paste + save it in the dashboard.

**Wait for user to confirm they have saved the AnnotsJSON in the dashboard.**

Once confirmed:
- Report: `✅ generate-annots-json done: N fields, file saved by user.`
- Continue to Step 3.

---

## Step 3 — Enrich ICD-10 panel prefixes (import-key-to-pdf)

> **Goal:** update every annotation whose `contents` =
> `diagnosis_icd10codes__<ICD>` (no panel prefix) →
> `diagnosis_icd10codes_panel_<Panel>__<ICD>`.

Full skill spec: `.claude/skills/import-key-to-pdf/SKILL.md`

### 3a — Analyze PDF and build ICD-10 panel mapping

1. Read the full PDF with the `Read` tool (`<PDF_PATH>`). Confirm all pages.
2. Load `/tmp/annots-<recform-slug>.json`.
3. Find all annotation objects where `contents` matches
   `diagnosis_icd10codes__<ICD>`.
4. For each: look up `<ICD>` in the PDF to determine its **panel name**.
5. Build mapping: `{ "<uuid>": "diagnosis_icd10codes_panel_<Panel>__<ICD>" }`.
6. Save to `/tmp/icd_map.json`.
7. If any ICD code has no matching panel → list them and **ask the user** to
   confirm the panel name. Do NOT proceed with unresolved codes.
8. Show confirmation table (UUID prefix · before · after).
   **Do NOT proceed until user confirms.**

### 3b — Apply mapping

1. Dry-run check — confirm UUID matches + count changes.
2. Backup: `cp /tmp/annots-<recform-slug>.json /tmp/annots-<recform-slug>.json.bak`
3. Apply mapping → verify.
4. Report: `✅ icd10-panel-fill: N changed, M skipped`

If there are **no** `diagnosis_icd10codes__<ICD>` entries → report
`ℹ️ No ICD-10 panel prefixes to apply. Skipping Step 3.` and continue to Step 4.

---

## Step 4 — Save enriched AnnotsJSON to dashboard

1. Navigate to: `<DASHBOARD_URL>/admin/ehealth/medicalpdf/<MEDICALPDF_ID>/change/`
2. Clear the **AnnotsJSON** Ace editor field.
3. Paste the full contents of `/tmp/annots-<recform-slug>.json`.
4. Click **Save**.
5. Wait for success confirmation.
6. Screenshot: `<recform-slug>/screenshots/<NN>-annots-json-saved.png`
7. Report: `✅ Workflow 05 done: AnnotsJSON updated and saved.`
8. Continue to Workflow 06.
