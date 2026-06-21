# Content Detection Rules

> Detect Test Type + Lab by **reading the PDF content**, NOT the filename.
> Filenames are unreliable (e.g. `CGX rec_Amedix.pdf` whose form title is
> actually "GERMLINE CANCER GENETIC").

## Step 1 — Run the detector

For each PDF, run the helper script with the skills venv python:

```bash
~/.claude/skills/.venv/bin/python3 \
  "<skill_dir>/scripts/detect-recform-type.py" "<ORIGINAL_PDF_PATH>"
```

It prints three sections:
- **DETECTED TITLE** — the form title (text above `TEST REQUISITION FORM`)
- **LAB CANDIDATES** — brand candidates from email domains + `X Lab(oratory)` phrases
- **PAGE 1 TEXT** — first-page text, for your own judgment

> Detect on the **ORIGINAL** PDF (not a flattened copy — flattened PDFs are
> image-only and have no extractable text).
> If pypdf errors or returns empty text (scanned/image-only original), fall back
> to reading the PDF directly with Claude's `Read` tool (it renders the PDF
> visually) and read the title + lab off page 1.

## Step 2 — Map to Test Type (Short Code)

Take the DETECTED TITLE and map it to a Short Code using the **Form Title →
Short Code** table in `abbreviation-map.md` (keyword match, case-insensitive).

If the detected title looks wrong (too long, generic, or no keyword match — can
happen on non-Amedix layouts), read the PAGE 1 TEXT yourself and find the panel
keyword (e.g. `PRIMARY IMMUNODEFICIENCY` → IMMUNO).

## Step 3 — Map to Lab

Take the LAB CANDIDATES and normalize to a clean Lab brand using the **Lab
Candidate → Lab Name** table in `abbreviation-map.md`.

## Step 4 — Derive names

Look up the Short Code and apply the **Derived Name Rules** in
`abbreviation-map.md` to build Description, tab names, specialty key, etc.

## Worked Examples

| PDF | Detected Title | Lab Candidate | → Test Type | → Lab |
|-----|----------------|---------------|-------------|-------|
| `Immunodeficiency Panel - Amedix Inc.pdf` | IMMUNODEFICIENCY | AMEDiX | IMMUNO | Amedix |
| `CGX rec_Amedix.pdf` | GERMLINE CANCER GENETIC | AMEDiX | CGX | Amedix |
| `Pharmacogenomics (PGx) Panel - Amedix Inc.pdf` | PHARMACOGENOMICS (PGX) | AMEDiX | PGX | Amedix |
| `Diabetes ... Panel - Amedix Inc.pdf` | DIABETES ETIOLOGY & DRUG RESPONSE | AMEDiX | DIABETES | Amedix |
| `Hightec  IMMUNO.pdf` | …PRIMARY IMMUNODEFICIENCY | Hightech | IMMUNO | Hightec |

> After detecting, look up the Short Code in `abbreviation-map.md`.
