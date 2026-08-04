---
name: verify-recform-icd10-import
description: >
  Audits the ICD-10 codes that were imported into a requisition PDF's AnnotsJSON
  against the codes the source PDF actually prints. Use whenever the user asks
  "check lại code import trong pdf đã đúng chưa", "verify the ICD-10 mapping",
  or after `import-lab-recform` Workflow 05 / `icd10-panel-fill` writes
  `diagnosis_icd10codes_panel_<Panel>__<ICD>` values. Reports per category:
  entries never filled, codes on the form never imported, imported codes not on
  the form, codes filed under the wrong panel, count mismatches, malformed codes.
  Phase A is a deterministic diff; Phase B is an independent second read of the
  PDF that catches MISREAD codes, which no format check can detect.
  Invoked as `verify-recform-icd10-import <annots.json> <panels.json>`.
---

# Verify — imported ICD-10 codes vs the requisition PDF

Answers one question: **are the codes imported into this PDF correct?**

Two artifacts get compared:

| | what | produced by |
|---|---|---|
| ground truth | `{"relevant_diagnosis_condition": {panel: {block: {icd_codes}}}}` | `extract-recform-icd10-panels` |
| imported | AnnotsJSON — array of annotations, each `name` = UUID, `contents` = `diagnosis_icd10codes_panel_<Panel>__<ICD>` | `import-lab-recform` W05 → `icd10-panel-fill` |

## Phase A — deterministic diff (always run this)

```bash
python3 .claude/skills/verify-recform-icd10-import/scripts/verify-icd10-import.py \
  --annots <annots.json> \
  --panels .claude/skills/extract-recform-icd10-panels/data/<form>.json \
  [--alias data/example-panel-alias.json] [--json report.json] [--limit 15]
```

Findings, in the order printed:

| category | meaning | usual cause |
|---|---|---|
| `unfilled` | `diagnosis_icd10codes__<ICD>` with no `_panel_` part | `icd10-panel-fill` never ran / UUID missing from the mapping |
| `unparsable` | mentions `diagnosis_icd10codes` but no code can be read | hand-edited `contents` |
| `malformed_code` | code fails ICD-10-CM shape | typo in the mapping |
| `unknown_panel` | panel token not resolvable to a form panel | short dashboard token → pass `--alias` |
| `missing` | the form prints it, nothing imported it | reader skipped a column (the SECONDARY table has TWO sub-columns) |
| `wrong_panel` | code exists on the form, but under other panel(s) | mapping built from the code instead of the UUID |
| `extra` | imported code appears nowhere on the form | misread code, or a code invented by hand |
| `count_mismatch` | imported N×, the form prints it M× | see multiplicity below |

**Multiplicity matters.** A code legitimately appears in both `PRIMARY ICD-10
CODES` and `CROSS-PANEL ICD10 CODES` of the same panel — the form prints TWO
checkboxes, so TWO identical annotations are correct. The checker compares counts
per (panel, code), not mere presence; a naive "duplicate" rule flags 7 false
positives on the AlphaDERA neuro form.

Exit code 0 = clean, 1 = findings. Both paths are covered by fixtures (a clean
AnnotsJSON exits 0; one with an injected defect of each class exits 1).

### Panel aliases

AnnotsJSON panel tokens are often short (`Neuro`, `Diabetes`, `Metabolic`,
`Immunodeficiency`) while the form headings are long
(`HEREDITARY PERIPHERAL NEUROPATHY`). Exact match is tried first, then a
normalized match (alphanumerics only, uppercased); anything left over is reported
as `unknown_panel` rather than guessed. Map those explicitly:

```json
{ "Neuro": "HEREDITARY PERIPHERAL NEUROPATHY" }
```

See `data/example-panel-alias.json`.

## Phase B — independent second read (run when the stakes are real)

Phase A proves the import is **consistent with the extracted JSON**. It cannot
prove the extracted JSON matches the paper, because both sides come from the same
visual read. A misread code (`M62.81` → `M82.81`) is self-consistent and passes
Phase A silently.

So for a form that matters, re-read it blind and diff:

1. Re-render the source PDF: `extract-recform-icd10-panels/scripts/render-recform-pages.sh`.
2. Read the strips **without looking at the existing JSON**, and write the codes
   to a scratch JSON in the same shape.
3. Diff the two ground-truth files:
   ```bash
   python3 - <<'PY'
   import json
   a = json.load(open('<existing>.json'))['relevant_diagnosis_condition']
   b = json.load(open('<second-read>.json'))['relevant_diagnosis_condition']
   for panel in sorted(set(a) | set(b)):
       for block in sorted(set(a.get(panel, {})) | set(b.get(panel, {}))):
           xa = set(a.get(panel, {}).get(block, {}).get('icd_codes', []))
           xb = set(b.get(panel, {}).get(block, {}).get('icd_codes', []))
           if xa != xb:
               print(f"{panel} / {block}\n  only-in-first : {sorted(xa - xb)}\n  only-in-second: {sorted(xb - xa)}")
   PY
   ```
4. Any difference is a candidate misread — go back to the 300-DPI strip for that
   row and settle it there, not from the page-scale render.

Codes that stay ambiguous after Phase B go into the JSON's `notes`, and the final
report lists them. Never let an ambiguous code pass silently as fact.

## Where this sits

```
extract-recform-icd10-panels   (PDF → panel/ICD JSON)
        ↓
import-lab-recform W05         (mapping → AnnotsJSON via icd10-panel-fill)
        ↓
verify-recform-icd10-import    (this skill: AnnotsJSON vs PDF)
```

## Report

```
✅ verify-recform-icd10-import
   Ground truth: <panels.json>   (<n> panels, <n> printed code rows)
   Imported:     <annots.json>   (<n> ICD annotations, +<n> other)
   Phase A:      OK / <n> findings — unfilled <n>, missing <n>, wrong_panel <n>,
                 extra <n>, count_mismatch <n>, malformed <n>, unknown_panel <n>
   Phase B:      run / skipped — <n> differing block(s)
   Ambiguous:    <list, or none>
```
