---
name: extract-recform-icd10-panels
description: >
  Reads a lab Test Requisition Form PDF (AlphaDERA Labs and similar) and emits a
  structured JSON of panel → ICD-10 codes: per test panel, PRIMARY ICD-10 CODES
  (required) and SECONDARY ICD-10 CODES (optional), plus CROSS-PANEL ICD10 CODES
  where the form lists them. Use whenever the user says "phân tích PDF này ra
  JSON", "extract ICD-10 panels from <file>.pdf", or needs the ICD10 panel mapping
  that `import-lab-recform` Workflow 05 (AnnotsJSON / icd10-panel-fill) consumes.
  These requisition PDFs are usually FLATTENED (each page is one image, no text
  layer), so extraction is a 300-DPI render + visual read, followed by a
  deterministic validator over the JSON shape and every ICD-10 code format.
  Invoked as `extract-recform-icd10-panels <path.pdf>`.
---

# Extract — Requisition Form → panel/ICD-10 JSON

Give it a requisition PDF; it returns one JSON mapping each test panel to its
ICD-10 code lists. Runs standalone, and feeds `import-lab-recform` Workflow 05
(`icd10-panel-fill` / AnnotsJSON) so the panel→code mapping is derived from the
form instead of typed by hand.

## Output shape (this is the contract)

```json
{
  "relevant_diagnosis_condition": {
    "HEREDITARY PERIPHERAL NEUROPATHY": {
      "PRIMARY ICD-10 CODES":   { "icd_codes": ["G60.0"], "required": true },
      "SECONDARY ICD-10 CODES": { "icd_codes": ["Z82.0", "M62.81", "R20.2"], "required": false }
    },
    "HEREDITARY PERIPHERAL NEUROPATHY NGS PANEL": {
      "PRIMARY ICD-10 CODES":    { "icd_codes": ["…"], "required": true },
      "SECONDARY ICD-10 CODES":  { "icd_codes": ["…"], "required": false },
      "CROSS-PANEL ICD10 CODES": { "icd_codes": ["…"], "required": false }
    }
  }
}
```

- `icd_codes` holds **code strings only** — no descriptions.
- `required`: `true` for PRIMARY, `false` for SECONDARY and CROSS-PANEL.
- Also keep `source_pdf`, `form_title`, `lab`, `extracted_at`,
  `extraction_method`, and a `notes` array for every judgement call the reader had
  to make. The validator ignores those keys.

### Panel naming

Each disease group on the form carries TWO ICD tables:

| Form block | Panel key |
|---|---|
| `PCR / MLPA / REPEAT EXPANSION — (separate methodology from NGS)` | `<GROUP>` |
| `NGS PANEL` (its `EXTENDED PANEL` shares the same ICD table) | `<GROUP> NGS PANEL` |

A group printed as `NO PCR / MLPA / REPEAT EXPANSION` (e.g. HEREDITARY DEMENTIA)
gets only the `… NGS PANEL` entry. Copy the group heading verbatim, including `&`
and any parenthetical.

## Flow

### 1. Check the text layer FIRST

```bash
pdftotext -layout "<pdf>" - | head -40
```

Real text → parse it, do not read images. Empty → flattened form, continue.
(The AlphaDERA neuro form: 4 pages, 1 image each, **0 characters**.)

### 2. Render + slice

```bash
.claude/skills/extract-recform-icd10-panels/scripts/render-recform-pages.sh "<pdf>" <out-dir> [first] [last]
```

300 DPI, three ~1700px-wide strips per page with 80px overlap, and it prints the
text-layer character count so step 1 is recorded.

**Never read codes off the page-level render.** At page scale the digits are
genuinely ambiguous: a first pass on 2026-07-31 misread `M62.81` as `M82.81`,
`G60.2` as `G80.2`, and `F02.B0` as `F02.80`. Read the strips.

### 3. Read every strip with the Read tool

Per group collect: the PRIMARY column, the SECONDARY column — it has **two
sub-columns**, the right one is easy to miss — and `CROSS-PANEL ICD10 CODES` when
present. Tables span pages: the HEREDITARY EPILEPSY NGS table starts at the
bottom of page 2 and its codes are at the top of page 3.

### 4. Write the JSON, then validate

```bash
python3 .claude/skills/extract-recform-icd10-panels/scripts/validate-recform-json.py <json>
```

Checks: every panel has a PRIMARY block, `icd_codes` non-empty, `required` matches
the block type, no duplicates inside a list, and every code matches ICD-10-CM
shape (letter-suffix codes `G40.A`, `G40.3A1`, `F02.A0`, `G20.A1` and the form's
`.x` family placeholders included). It prints a per-panel count table — compare
those counts against the strips before declaring done. Exit 1 on errors.

The validator catches **malformed** codes, never a **misread** one. Anything
ambiguous goes in `notes`, not silently into `icd_codes`.

### 5. After the codes are imported — audit them

`verify-recform-icd10-import` diffs the dashboard AnnotsJSON against this JSON
(unfilled entries, codes never imported, wrong panel, extras, count mismatches),
and its Phase B does an independent second read of the PDF to catch misreads that
no format check can see. Run it after `import-lab-recform` W05.

## Transcription rules (decided 2026-07-31 — keep consistent)

- `I42.1/I42.2` (Hypertrophic cardiomyopathy) is one printed row for two codes →
  split into `I42.1` and `I42.2`.
- A CROSS-PANEL row printed as a combination (`G60.0 (…) + G71.09 (…)`) → split
  into separate entries in the same list.
- `F80.x`, `Z80.x`, `C50.x`, `C64.x` stay exactly as printed — family
  placeholders, not billable codes. Never invent a 4th character.
- Gene lists (`GJB1, MPZ, MFN2 …`), methodology checkboxes and EXTENDED PANEL
  gene lists are NOT part of this output — ICD tables only.

## Done: Neurological Disorders — AlphaDERA Labs

`data/neurological-disorders-alphadera-labs.json` — 15 panels, 35 blocks,
128 distinct codes, validator clean. Groups: Hereditary Peripheral Neuropathy,
Hereditary Ataxia & Hereditary Spastic Paraplegia, ALS & Motor Neuron Disease,
Hereditary Epilepsy & Epileptic Encephalopathy, Neurodevelopmental Panels (XLID /
Autism / Migration), Hereditary Movement Disorders, Hereditary Dementia,
Hereditary Neuromuscular Disorders.

## Report

```
✅ extract-recform-icd10-panels done
   PDF:        <file>  (<n> pages, text layer: <n> chars)
   Panels:     <n>  (PRIMARY <n> / SECONDARY <n> / CROSS-PANEL <n> blocks)
   Codes:      <n> distinct
   Output:     .claude/skills/extract-recform-icd10-panels/data/<name>.json
   Validator:  OK (0 errors)
   Ambiguous:  <list, or none>
```
