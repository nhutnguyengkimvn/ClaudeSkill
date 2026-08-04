#!/usr/bin/env python3
"""Validate a recform panels CSV: header, panel rows, gene lists, ICD-10 format.

The extraction is a visual read (these requisition PDFs are flattened, no text
layer), so this script is the safety net. It cannot know whether a gene or a code
was MISREAD — that is what the second-pass review + diff-two-reads.py is for. It
catches every mistake that has a *shape*: wrong header, unknown panel_type, a
panel-scoped row with no PRIMARY codes, a malformed ICD-10 code, duplicates.

Usage:
  validate-panels-csv.py <csv> [--quiet]
Exit 1 if any ERROR is found (warnings alone do not fail).
"""
import csv
import re
import sys

COLUMNS = [
    "panel", "panel_type", "test_parameters", "extended_parameters",
    "icd_scope", "icd_primary", "icd_secondary", "icd_cross_panel", "notes",
]

# ICD-10-CM: letter, 2 digits, optional '.' + up to 4 alphanumerics. Allows the
# form's family placeholders (F80.x, Z80.x), letter-suffix codes (G40.A,
# G40.3A1, F02.A0, G20.A1) and 7th-character extensions (T75.3XXA).
ICD_RE = re.compile(r"^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Zx]{1,4})?$")
# A bare gene symbol, optionally with an alias in parentheses: PARK7 (DJ-1).
GENE_RE = re.compile(r"^[A-Z][A-Z0-9\-]*(\s*\([A-Za-z0-9\-]+\))?$")

PANEL_TYPES = {"NGS_PANEL", "PCR_MLPA_REPEAT_EXPANSION", "GENE_PANEL", "FORM_ICD"}
GENE_ONLY_TYPES = {"NGS_PANEL", "GENE_PANEL"}
ICD_SCOPES = {"panel", "form"}
ICD_COLS = ["icd_primary", "icd_secondary", "icd_cross_panel"]


def split_list(cell):
    return [p.strip() for p in cell.split(";") if p.strip()]


def check_dupes(items, where, label, errors):
    seen = set()
    for it in items:
        if it in seen:
            errors.append(f"{where}: duplicate {label} {it!r}")
        seen.add(it)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path, quiet = sys.argv[1], "--quiet" in sys.argv

    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
        fieldnames = list(rows[0].keys()) if rows else []

    errors, warnings, stats = [], [], []
    if fieldnames != COLUMNS:
        print(f"ERROR: header mismatch\n  expected: {COLUMNS}\n  found:    {fieldnames}")
        return 1
    if not rows:
        print("ERROR: no data rows")
        return 1

    panels, all_codes, all_genes = set(), set(), set()
    form_icd_rows = [r for r in rows if r["panel_type"] == "FORM_ICD"]

    for i, row in enumerate(rows, start=2):  # +2: 1-based, past the header
        panel = row["panel"].strip()
        where = f"row {i} ({panel or '<empty>'})"
        ptype, scope = row["panel_type"].strip(), row["icd_scope"].strip()

        if not panel:
            errors.append(f"{where}: empty panel name")
        elif panel in panels:
            errors.append(f"{where}: duplicate panel name")
        panels.add(panel)

        if ptype not in PANEL_TYPES:
            errors.append(f"{where}: unknown panel_type {ptype!r} (allowed: {sorted(PANEL_TYPES)})")
        if scope not in ICD_SCOPES:
            errors.append(f"{where}: unknown icd_scope {scope!r} (allowed: {sorted(ICD_SCOPES)})")

        params = split_list(row["test_parameters"])
        extended = split_list(row["extended_parameters"])
        codes = {c: split_list(row[c]) for c in ICD_COLS}

        if ptype == "FORM_ICD":
            # The shared, form-level ICD list: no test parameters of its own.
            if scope != "form":
                errors.append(f"{where}: FORM_ICD row must have icd_scope=form")
            if params or extended:
                errors.append(f"{where}: FORM_ICD row must not carry test parameters")
            if not codes["icd_primary"]:
                errors.append(f"{where}: FORM_ICD row has no icd_primary codes")
        else:
            if not params:
                errors.append(f"{where}: test_parameters is empty")
            if scope == "panel" and not codes["icd_primary"]:
                errors.append(f"{where}: panel-scoped row has no icd_primary codes")
            if scope == "form" and any(codes.values()):
                errors.append(
                    f"{where}: icd_scope=form but the row carries its own codes — "
                    "form-level codes belong on the FORM_ICD row"
                )
            if extended and ptype not in GENE_ONLY_TYPES:
                warnings.append(f"{where}: extended_parameters on a {ptype} row")

        check_dupes(params, where, "test parameter", errors)
        check_dupes(extended, where, "extended parameter", errors)
        for token in params + extended:
            if ptype in GENE_ONLY_TYPES and not GENE_RE.match(token):
                warnings.append(f"{where}: {token!r} does not look like a gene symbol")
            all_genes.add(token)

        for col, items in codes.items():
            check_dupes(items, f"{where} / {col}", "code", errors)
            for code in items:
                if not ICD_RE.match(code):
                    errors.append(f"{where} / {col}: malformed ICD-10 code {code!r}")
                all_codes.add(code)

        stats.append((panel, ptype, len(params), len(extended),
                      [len(codes[c]) for c in ICD_COLS]))

    if len(form_icd_rows) > 1:
        errors.append(f"{len(form_icd_rows)} FORM_ICD rows — expected at most 1")
    if any(r["icd_scope"] == "form" for r in rows) and not form_icd_rows:
        errors.append("rows declare icd_scope=form but there is no FORM_ICD row to hold the codes")

    if not quiet:
        print(f"file: {path}")
        print(f"panels: {len(rows)}   distinct params: {len(all_genes)}   distinct codes: {len(all_codes)}")
        for panel, ptype, n_par, n_ext, (p, s, x) in stats:
            ext = f" +{n_ext} ext" if n_ext else ""
            print(f"  - {panel}  [{ptype}]  params={n_par}{ext}  P={p} S={s} X={x}")
        placeholders = sorted(c for c in all_codes if c.endswith(".x"))
        if placeholders:
            print(f"family placeholders (as printed on the form): {', '.join(placeholders)}")

    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    print(f"\n{'FAILED' if errors else 'OK'} — {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
