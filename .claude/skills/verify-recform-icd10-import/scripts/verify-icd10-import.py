#!/usr/bin/env python3
"""Diff the ICD-10 codes IMPORTED into a PDF's AnnotsJSON against the codes the
requisition form actually prints.

Two artifacts, one question — "are the imported codes right?":
  * ground truth  = the panel/ICD JSON from `extract-recform-icd10-panels`
                    ({"relevant_diagnosis_condition": {panel: {block: {icd_codes}}}})
  * imported      = the dashboard AnnotsJSON (array of annotation objects, each
                    with `name` = UUID and `contents` =
                    `diagnosis_icd10codes_panel_<Panel>__<ICD>`)

It reports, per category: entries never filled (still short-form, no panel),
codes on the form that were never imported, imported codes the form does not
list, codes filed under the WRONG panel, count mismatches (a code the form prints
twice — PRIMARY *and* CROSS-PANEL — must be imported twice), and malformed codes.
Exit 1 if anything actionable is found.

Panel tokens in AnnotsJSON are usually short (`Neuro`, `Diabetes`) while the form
headings are long ("HEREDITARY PERIPHERAL NEUROPATHY"), so pass --alias with
{"<annots panel token>": "<form panel key>"} when they differ. Unmapped tokens
are reported rather than guessed.

Usage:
  verify-icd10-import.py --annots <annots.json> --panels <extracted.json>
                         [--alias <alias.json>] [--json <report.json>] [--limit N]
"""
import argparse
import json
import re
import sys
from collections import defaultdict

CONTENTS_RE = re.compile(r"^diagnosis_icd10codes(?:_panel_(.+?))?__(.+)$")
ICD_RE = re.compile(r"^[A-TV-Z][0-9][0-9A-Z](\.([0-9A-Zx]{1,4}))?$")


def norm(s: str) -> str:
    """Loose panel comparison key: alphanumerics only, uppercased."""
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def load_truth(path):
    """Returns (truth, by_code, expected_count, blocks_of).

    truth[panel]              = set(codes)
    by_code[code]             = set(panels listing it)
    expected_count[panel,code]= how many BLOCKS of that panel list the code
    blocks_of[panel,code]     = names of those blocks

    The count matters: a code legitimately appears in both PRIMARY and
    CROSS-PANEL of the same panel, so the form prints TWO checkboxes for it and
    two identical annotations are correct — not a duplicate.
    """
    data = json.loads(open(path).read())
    panels = data.get("relevant_diagnosis_condition") or {}
    truth, by_code = {}, defaultdict(set)
    expected_count, blocks_of = defaultdict(int), defaultdict(list)
    for panel, blocks in panels.items():
        codes = set()
        for block, body in blocks.items():
            if not isinstance(body, dict):
                continue
            for c in body.get("icd_codes") or []:
                codes.add(c)
                by_code[c].add(panel)
                expected_count[(panel, c)] += 1
                blocks_of[(panel, c)].append(block)
        truth[panel] = codes
    return truth, by_code, expected_count, blocks_of


def load_imported(path):
    """Parse AnnotsJSON. Returns (entries, non_icd_count).

    entries: list of {uuid, panel (None if short-form), code, contents}
    """
    data = json.loads(open(path).read())
    if isinstance(data, dict):  # some exports wrap the array
        for key in ("annots", "annotations", "data"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if not isinstance(data, list):
        raise SystemExit("ERROR: AnnotsJSON must be an array of annotation objects")
    entries, others = [], 0
    for obj in data:
        if not isinstance(obj, dict):
            continue
        contents = obj.get("contents")
        if not isinstance(contents, str) or "diagnosis_icd10codes" not in contents:
            others += 1
            continue
        m = CONTENTS_RE.match(contents.strip())
        if not m:
            entries.append({"uuid": obj.get("name"), "panel": None, "code": None,
                            "contents": contents.strip()})
            continue
        entries.append({"uuid": obj.get("name"), "panel": m.group(1),
                        "code": m.group(2), "contents": contents.strip()})
    return entries, others


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--annots", required=True)
    ap.add_argument("--panels", required=True)
    ap.add_argument("--alias")
    ap.add_argument("--json")
    ap.add_argument("--limit", type=int, default=15)
    a = ap.parse_args()

    truth, truth_by_code, expected_count, blocks_of = load_truth(a.panels)
    entries, others = load_imported(a.annots)
    alias = json.loads(open(a.alias).read()) if a.alias else {}

    # resolve every annots panel token to a form panel key
    by_norm = {norm(p): p for p in truth}
    resolved, unresolved_tokens = {}, set()
    for e in entries:
        tok = e["panel"]
        if tok is None:
            continue
        if tok in resolved:
            continue
        target = alias.get(tok) or (tok if tok in truth else by_norm.get(norm(tok)))
        if target:
            resolved[tok] = target
        else:
            unresolved_tokens.add(tok)

    report = {
        "unfilled": [],        # no panel prefix → icd10-panel-fill never ran on it
        "unparsable": [],      # contents mentions diagnosis_icd10codes but has no code
        "malformed_code": [],
        "unknown_panel": sorted(unresolved_tokens),
        "missing": [],         # on the form, never imported
        "extra": [],           # imported, not on the form at all
        "wrong_panel": [],     # code exists on the form but under other panel(s)
        "count_mismatch": [],  # imported N times, the form prints it M times
    }

    seen_pairs = defaultdict(list)
    imported_pairs = set()
    for e in entries:
        if e["code"] is None:
            report["unparsable"].append({"uuid": e["uuid"], "contents": e["contents"]})
            continue
        if e["panel"] is None:
            report["unfilled"].append({"uuid": e["uuid"], "contents": e["contents"]})
            continue
        if not ICD_RE.match(e["code"]):
            report["malformed_code"].append({"uuid": e["uuid"], "code": e["code"]})
        panel = resolved.get(e["panel"])
        if panel is None:
            continue  # already reported as unknown_panel
        seen_pairs[(panel, e["code"])].append(e["uuid"])
        imported_pairs.add((panel, e["code"]))
        if e["code"] not in truth.get(panel, set()):
            expected = sorted(truth_by_code.get(e["code"], []))
            if expected:
                report["wrong_panel"].append({
                    "code": e["code"], "imported_under": panel, "form_lists_under": expected,
                    "uuid": e["uuid"],
                })
            else:
                report["extra"].append({"code": e["code"], "imported_under": panel, "uuid": e["uuid"]})

    # compare multiplicity, not mere presence
    for (panel, code), uuids in seen_pairs.items():
        expected = expected_count.get((panel, code), 0)
        if expected and len(uuids) != expected:
            report["count_mismatch"].append({
                "panel": panel, "code": code, "imported": len(uuids), "expected": expected,
                "form_blocks": blocks_of[(panel, code)], "uuids": uuids,
            })

    for panel, codes in truth.items():
        for code in sorted(codes):
            if (panel, code) not in imported_pairs:
                report["missing"].append({
                    "panel": panel, "code": code,
                    "form_blocks": blocks_of[(panel, code)],
                })

    # ---- print ----
    print(f"ground truth : {a.panels}")
    print(f"imported     : {a.annots}")
    print(f"panels(form) : {len(truth)}   codes(form pairs): {sum(len(c) for c in truth.values())}")
    print(f"annots       : {len(entries)} icd entries (+{others} other annotations)")
    if alias:
        print(f"alias        : {len(alias)} panel token(s) mapped")
    print()
    order = ["unfilled", "unparsable", "malformed_code", "unknown_panel",
             "missing", "wrong_panel", "extra", "count_mismatch"]
    problems = 0
    for key in order:
        items = report[key]
        if not items:
            print(f"  ok  {key}: 0")
            continue
        problems += len(items)
        print(f"  !!  {key}: {len(items)}")
        for item in items[: a.limit]:
            print(f"        {json.dumps(item, ensure_ascii=False)}")
        if len(items) > a.limit:
            print(f"        … {len(items) - a.limit} more")

    if a.json:
        open(a.json, "w").write(json.dumps(report, ensure_ascii=False, indent=2))
        print(f"\nreport written: {a.json}")
    print(f"\n{'FAILED' if problems else 'OK'} — {problems} finding(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
