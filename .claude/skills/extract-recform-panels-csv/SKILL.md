---
name: extract-recform-panels-csv
description: >
  Reads one or more lab Test Requisition Form PDFs and emits ONE CSV per PDF
  listing every orderable panel with its test parameters (gene list / assay
  labels) and its ICD-10 codes. Handles both requisition layouts: per-panel ICD
  tables (AlphaDERA-style NGS / PCR-MLPA forms) and a single shared form-level
  ICD list (Isacare PGx-style panel-composition forms). Use whenever the user
  says "export panel list to CSV", "lấy list panel ra csv", "extract panels +
  test params + icd from these PDFs", or hands over several requisition PDFs at
  once. These PDFs are usually FLATTENED (one image per page, no text layer), so
  extraction is a 300-DPI render + visual read, then a deterministic validator,
  then a SECOND independent read diffed against the first before the result is
  reported. Invoked as `extract-recform-panels-csv <path1.pdf> [<path2.pdf> ...]`.
---

# Extract — Requisition Form → panels CSV

N PDFs in, N CSVs out. Each CSV answers one question per row: *what can be
ordered, what does it test, and which ICD-10 codes back it up.*

Related: `extract-recform-icd10-panels` produces the ICD-only JSON that
`import-lab-recform` W05 / `icd10-panel-fill` consume. This skill is the superset
— it adds the gene/assay lists and emits CSV. Use that one when the JSON contract
is what's needed downstream; use this one when a human or a spreadsheet is.

## Output shape (this is the contract)

One CSV per PDF, written to `./recform-panels/<test-type>-<lab>.csv` by default
(override with `--out-dir <dir>`). Header, exactly:

```
panel,panel_type,test_parameters,extended_parameters,icd_scope,icd_primary,icd_secondary,icd_cross_panel,notes
```

| column | meaning |
|---|---|
| `panel` | the orderable panel, named verbatim from the form. Unique — it is the join key |
| `panel_type` | `NGS_PANEL` · `PCR_MLPA_REPEAT_EXPANSION` · `GENE_PANEL` · `FORM_ICD` |
| `test_parameters` | genes or assay labels for that panel |
| `extended_parameters` | the EXTENDED PANEL gene list, when the form has one |
| `icd_scope` | `panel` = codes printed under this panel · `form` = form shares one list |
| `icd_primary` / `icd_secondary` / `icd_cross_panel` | code strings only, no descriptions |
| `notes` | every judgement call the reader had to make |

**Every list cell is `; `-separated** (semicolon + space), never comma — assay
labels such as `ATXN1, ATXN2, ATXN3 and ATXN7 | PCR repeat expansion` contain
commas of their own.

## The two layouts — decide this first

After rendering, look at where the ICD-10 codes live. That single fact picks the
layout:

**Type A — per-panel ICD tables** (AlphaDERA Neurological Disorders). The form is
a sequence of disease GROUPS, each with a blue heading, and each group carries its
own `PRIMARY ICD-10 CODES` / `SECONDARY ICD-10 CODES` tables.

| Form block | Row |
|---|---|
| `PCR / MLPA / REPEAT EXPANSION — (separate methodology from NGS)` | `panel` = `<GROUP>`, `panel_type` = `PCR_MLPA_REPEAT_EXPANSION`, `test_parameters` = the full assay label of each checkbox, verbatim |
| `NGS PANEL` (+ its `EXTENDED PANEL`, which shares the same ICD table) | `panel` = `<GROUP> NGS PANEL`, `panel_type` = `NGS_PANEL`, `test_parameters` = base gene list, `extended_parameters` = EXTENDED gene list |

`icd_scope` = `panel` everywhere. A `CROSS-PANEL ICD10 CODES` block attaches to
the panel it is printed under. A group headed `NO PCR / MLPA / REPEAT EXPANSION`
(e.g. HEREDITARY DEMENTIA) yields only the `… NGS PANEL` row. Copy group headings
verbatim including `&` and parentheticals — but drop a
`(NO PCR / MLPA / REPEAT EXPANSION)` suffix from the panel name.

**Type B — one shared ICD list** (Isacare Pharmacogenomics PGx). A
`TEST PANEL SELECTION` table maps each panel to its `PANEL COMPOSITION` gene list,
and a single `DIAGNOSIS (ICD-10) CODES` section applies to the whole form.

- One row per panel: `panel_type` = `GENE_PANEL`, `icd_scope` = `form`, and the
  three ICD columns **empty**.
- Plus exactly one row holding the shared list: `panel` = `ALL PANELS`,
  `panel_type` = `FORM_ICD`, `icd_scope` = `form`, no test parameters.

Do not copy the shared list onto every panel row — the validator rejects that, and
it hides the fact that the form never assigned codes per panel.

A form could mix both (per-panel tables *and* a trailing shared list). Nothing
forbids it: use `icd_scope` per row and add the `FORM_ICD` row.

**Type A variant — Primary Diagnostics Laboratory forms.** Same "codes live under
the panel" logic, different printing: each panel is a `q <Panel Name>` checkbox
line followed by its gene list and then its own `PRIMARY` / `SECONDARY` tables.
There is no PCR-vs-NGS split, so the row is `GENE_PANEL`.

**One row per orderable *panel*, never per assay line.** When a block prints
assay lines under a panel that already owns the ICD table — the metabolic form's
`mtDNA (full gene sequencing) | NGS — whole mitochondrial genome` and
`mtDNA (large deletion) | Long-range PCR` under `MITOCHONDRIAL GENOME PANEL` —
those lines are **parameters of that panel**: append them to its
`test_parameters` and say so in `notes`. Do not give them their own rows; a row
with no ICD codes of its own is indistinguishable from a dropped ICD table.

A reflex block that owns its own ICD table (`MITOCHONDRIAL DIABETES (MIDD) REFLEX
TESTING`) is a normal `GENE_PANEL` row: the targeted assay in `test_parameters`,
the reflex composition in `extended_parameters`.

**When a block does not fit these four types, do not invent a fifth.** Map it to
the closest type, keep the data, and raise the oddity in the report so the user
decides. Vocabulary growth is not the reader's call.

These forms sometimes print an **indented sub-list under a SECONDARY code**: a
combination the payer expects to see together (`E11.8` followed by an indented
`E78.2 / E78.49 / I10`). Flatten the sub-list into the same `icd_secondary` cell
in printed order and describe the pairing in `notes` — never drop it, and never
invent a separate column for it.

## Flow

### 1. Check the text layer FIRST

```bash
pdftotext -layout "<pdf>" - | head -40
```

Real text → parse it, do not read images. Near-zero characters → flattened,
continue. (Both reference forms return 0.)

### 2. Render + slice

Reuse the renderer from the sibling skill — do not write a second one:

```bash
.claude/skills/extract-recform-icd10-panels/scripts/render-recform-pages.sh "<pdf>" <out-dir>
```

300 DPI, three ~1700px-wide strips per page with 80px overlap.

**Never read codes or gene symbols off the page-level render.** At page scale the
glyphs are genuinely ambiguous — a documented first pass misread `M62.81` as
`M82.81`, `G60.2` as `G80.2`, `F02.B0` as `F02.80`. Read the strips.

### 3. Read every strip with the Read tool

Strips overlap, so rows repeat between consecutive strips — do not double-count.
Per panel collect: gene list, EXTENDED gene list, PRIMARY column, SECONDARY column
(**it has two sub-columns; the right one is easy to miss**), and any CROSS-PANEL
block. Tables span pages — the epilepsy NGS table starts at the bottom of page 2
and its codes are at the top of page 3.

### 4. Write the CSV, then validate

Write it with a real CSV writer (Python `csv`), not by hand — assay labels contain
commas and need quoting.

```bash
python3 .claude/skills/extract-recform-panels-csv/scripts/validate-panels-csv.py <csv>
```

Checks the header, unique panel names, the `panel_type` / `icd_scope` vocabulary,
that every panel-scoped row has PRIMARY codes and non-empty test parameters, that
`FORM_ICD` rows carry codes and no parameters, ICD-10-CM code shape (letter-suffix
codes `G40.A`, `G40.3A1`, `F02.A0`, 7th-character `T75.3XXA` and `.x` family
placeholders included), gene-symbol shape, and duplicates inside any cell. It
prints a per-panel count table — compare those counts against the strips. Exit 1
on errors.

### 5. Second read + diff — the review step, not optional

The validator catches **malformed** data; it can never catch a **misread**
(`SPTBN2` → `SPTBN1` is perfectly well-formed). The only defence is reading the
form twice and diffing.

Delegate a fresh read to a subagent — one per PDF, run in parallel. Tell it to
read only the strips and to ignore any existing transcription, give it the same
column contract and the same panel-naming rule (the panel name is the diff's join
key), and have it write to a separate path. Then:

```bash
python3 .claude/skills/extract-recform-panels-csv/scripts/diff-two-reads.py <first.csv> <second.csv>
```

Every reported DIFF is either a misread in one of the reads or a genuine
judgement call. Re-read the strips for that panel and resolve it — **never ship a
CSV with unresolved diffs, and never resolve one by picking a side without looking
at the image again.** Record resolved judgement calls in `notes`.

### 6. Report per PDF (see below), then stop

## Transcription rules (keep consistent across forms)

- One printed row holding two codes (`I42.1/I42.2`) → two codes.
- A CROSS-PANEL row printed as a combination (`G60.0 (…) + G71.09 (…)`) → the
  individual codes, in printed order, in the same cell.
- `F80.x`, `Z80.x`, `C50.x`, `C64.x` stay exactly as printed — family
  placeholders, not billable codes. Never invent a 4th character.
- Gene aliases stay attached: `PARK7 (DJ-1)`, `PAFAH1B1 (LIS1)`.
- Assay labels are copied whole, pipe included:
  `PMP22 Full Seq | NGS — Run only if PMP22 Dup/Del negative` — pipe and method
  included, never truncated to `PMP22 Full Seq`. This holds whether the label ends
  up in `test_parameters` or, for an AlphaDERA PCR block, alongside its siblings
  there.
- Footnote expansions (`*1 Anaerococcus prevotii, …` under a species list) go in
  `extended_parameters` **with the `*n` marker kept as a prefix on the first
  species of each group** — that marker is the only link back to the
  `Citrobacter species *2` entry in `test_parameters`.
- Column headers that mean primary/secondary without saying so (`CATEGORY I` /
  `CATEGORY 2`) map by column position: left → `icd_primary`, right →
  `icd_secondary`. Say so in `notes`.
- Descriptions are never stored — the ICD columns hold codes only. Anything the
  form prints oddly (a stray `checkbox)` prefix, a trailing `v`) is transcribed
  cleanly and flagged in `notes`.
- Anything still ambiguous after a second look goes in `notes`, not silently into
  a data cell.

## Reference runs — 11 forms, every one double-read and validator-clean

| CSV (in `recform-panels/`) | Rows | Layout | Codes |
|---|---|---|---|
| `neurological-disorders-alphadera-labs` | 15 | A (7 PCR + 8 NGS) | 128 |
| `germline-cancer-alphadera-labs` | 8 + `FORM_ICD` | B | 100 |
| `cancer-genetics-cgx-primary-diagnostics-lab` | 8 + `FORM_ICD` | B | 100 |
| `pharmacogenomics-pgx-alphadera-labs` | 7 + `FORM_ICD` | B | 49 |
| `pharmacogenomics-pgx-isacare-labs` | 7 + `FORM_ICD` | B | 49 |
| `pharmacogenomics-pgx-primary-diagnostics-lab` | 8 + `FORM_ICD` | B | 48 |
| `primary-immunodeficiency-alphadera-labs` | 2 + `FORM_ICD` | B | 77 |
| `uti-abr-knucks-labs` | 2 + `FORM_ICD` | B | 27 |
| `immunodeficiency-primary-diagnostics-lab` | 5 | A variant | 44 |
| `monogenic-diabetes-primary-diagnostics-lab` | 3 | A variant | 66 |
| `metabolic-disorders-primary-diagnostics-lab` | 3 | A variant | 72 |

**Twin forms.** `cancer-genetics-cgx-primary-diagnostics-lab` ≡
`germline-cancer-alphadera-labs`, and `pharmacogenomics-pgx-alphadera-labs` ≡
`pharmacogenomics-pgx-isacare-labs` — byte-identical panel data under different
labs. Four independent reads per pair, each blind to the others, agreed exactly.
When a batch contains a rebranded template, cross-diffing the two CSVs is a free
extra check.

**Resolved diffs worth remembering:** the `PABPN1` line on the neuro form carries a
stray printed `checkbox)` prefix (cleaned, noted); the metabolic mtDNA assay lines
are parameters of `MITOCHONDRIAL GENOME PANEL`, not rows; UTI footnote species keep
their `*n` markers.

`pharmacogenomics-pgx-primary-diagnostics-lab` is the only PGx form of the three
that prints a **`FOCUSED PGx`** panel (9 genes) and a 13-gene `COMPREHENSIVE PGx` —
the AlphaDERA/Isacare pair drops Focused and carries 18 comprehensive genes.

## Report

```
✅ extract-recform-panels-csv — <n> PDF(s)

<file>.pdf  (<n> pages, text layer: <n> chars, layout: A|B)
   Panels:    <n>   (<breakdown by panel_type>)
   Params:    <n> distinct genes/assays
   Codes:     <n> distinct   (P <n> / S <n> / cross <n>)
   Output:    recform-panels/<name>.csv
   Validator: OK (0 errors, <n> warnings)
   2nd read:  IDENTICAL  (or: <n> diffs, all resolved — <what changed>)
   Ambiguous: <list, or none>
```
