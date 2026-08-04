#!/usr/bin/env python3
"""Validate an import-lab-recform JSON: shape, ICD-10 format, duplicates.

The extraction itself is a visual read (flattened PDFs have no text layer), so
this script is the safety net: it cannot know whether a code was misread, but it
catches every mistake that has a *shape*: a malformed code, a panel missing its
PRIMARY block, a wrong `required` flag, duplicates inside one list.

Usage:
  validate-recform-json.py <json> [--quiet]
Exit code 1 if any ERROR is found (warnings alone do not fail).
"""
import json
import re
import sys

# ICD-10-CM: letter, 2 digits, optional '.' + up to 4 alphanumerics.
# Also allows the form's family placeholders (F80.x, Z80.x) and letter-suffix
# codes introduced in recent revisions (G40.A, G40.3A1, F02.A0, G20.A1).
ICD_RE = re.compile(r"^[A-TV-Z][0-9][0-9A-Z](\.([0-9A-Zx]{1,4}))?$")

PRIMARY = "PRIMARY ICD-10 CODES"
SECONDARY = "SECONDARY ICD-10 CODES"
CROSS = "CROSS-PANEL ICD10 CODES"
KNOWN_BLOCKS = {PRIMARY, SECONDARY, CROSS}
REQUIRED_FLAG = {PRIMARY: True, SECONDARY: False, CROSS: False}


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    quiet = "--quiet" in sys.argv
    data = json.loads(open(path).read())

    errors, warnings = [], []
    panels = data.get("relevant_diagnosis_condition")
    if not isinstance(panels, dict) or not panels:
        print("ERROR: relevant_diagnosis_condition missing or empty")
        return 1

    all_codes, stats = set(), []
    for panel, blocks in panels.items():
        if not isinstance(blocks, dict):
            errors.append(f"{panel}: not an object")
            continue
        if PRIMARY not in blocks:
            errors.append(f"{panel}: missing '{PRIMARY}'")
        for block, body in blocks.items():
            where = f"{panel} / {block}"
            if block not in KNOWN_BLOCKS:
                warnings.append(f"{where}: unknown block name")
            if not isinstance(body, dict):
                errors.append(f"{where}: not an object")
                continue
            codes = body.get("icd_codes")
            if not isinstance(codes, list) or not codes:
                errors.append(f"{where}: icd_codes missing or empty")
                continue
            if "required" not in body:
                errors.append(f"{where}: missing 'required'")
            elif block in REQUIRED_FLAG and body["required"] != REQUIRED_FLAG[block]:
                errors.append(
                    f"{where}: required={body['required']}, expected {REQUIRED_FLAG[block]}"
                )
            seen = set()
            for code in codes:
                if not isinstance(code, str):
                    errors.append(f"{where}: non-string code {code!r}")
                    continue
                if not ICD_RE.match(code):
                    errors.append(f"{where}: malformed ICD-10 code {code!r}")
                if code in seen:
                    errors.append(f"{where}: duplicate code {code!r}")
                seen.add(code)
                all_codes.add(code)
            stats.append((where, len(codes)))

    if not quiet:
        print(f"file: {path}")
        print(f"panels: {len(panels)}   blocks: {len(stats)}   distinct codes: {len(all_codes)}")
        for panel, blocks in panels.items():
            parts = [
                f"{b.replace(' ICD-10 CODES', '').replace(' ICD10 CODES', '')}={len(body['icd_codes'])}"
                for b, body in blocks.items()
                if isinstance(body, dict) and isinstance(body.get("icd_codes"), list)
            ]
            print(f"  - {panel}: {', '.join(parts)}")
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
