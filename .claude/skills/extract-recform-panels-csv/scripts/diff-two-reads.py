#!/usr/bin/env python3
"""Diff two independent reads of the same requisition form.

The validator only catches malformed data. A MISREAD — G60.2 typed as G80.2,
SPTBN2 as SPTBN1 — is perfectly well-formed and invisible to it. The only way to
catch one is to read the form twice, independently, and diff. This script is the
mechanical half of that review: run it on read-1 vs read-2 and every cell that
disagrees is either a misread in one of them or a genuine judgement call.

Usage:
  diff-two-reads.py <first.csv> <second.csv>
Exit 1 if the two reads disagree anywhere.
"""
import csv
import sys

LIST_COLS = ["test_parameters", "extended_parameters",
             "icd_primary", "icd_secondary", "icd_cross_panel"]
SCALAR_COLS = ["panel_type", "icd_scope"]


def load(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return {r["panel"].strip(): r for r in csv.DictReader(fh)}


def as_list(cell):
    return [p.strip() for p in cell.split(";") if p.strip()]


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    first_path, second_path = sys.argv[1], sys.argv[2]
    first, second = load(first_path), load(second_path)

    diffs = []
    only_first = [p for p in first if p not in second]
    only_second = [p for p in second if p not in first]
    for p in only_first:
        diffs.append(f"panel only in read-1: {p!r}")
    for p in only_second:
        diffs.append(f"panel only in read-2: {p!r}")

    for panel in first:
        if panel not in second:
            continue
        a, b = first[panel], second[panel]
        for col in SCALAR_COLS:
            if a[col].strip() != b[col].strip():
                diffs.append(f"{panel} / {col}: read-1={a[col]!r} vs read-2={b[col]!r}")
        for col in LIST_COLS:
            la, lb = as_list(a[col]), as_list(b[col])
            missing = [x for x in la if x not in lb]
            extra = [x for x in lb if x not in la]
            if missing:
                diffs.append(f"{panel} / {col}: in read-1 only -> {', '.join(missing)}")
            if extra:
                diffs.append(f"{panel} / {col}: in read-2 only -> {', '.join(extra)}")
            if not missing and not extra and la != lb:
                diffs.append(f"{panel} / {col}: same items, different order")

    print(f"read-1: {first_path}  ({len(first)} panels)")
    print(f"read-2: {second_path}  ({len(second)} panels)")
    for d in diffs:
        print(f"DIFF: {d}")
    print(f"\n{'MISMATCH' if diffs else 'IDENTICAL'} — {len(diffs)} difference(s)")
    if diffs:
        print("Re-read the strips for each panel above before shipping the CSV.")
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main())
