#!/usr/bin/env python3
"""Build a Form.io form JSON from the DNAi field-mapping sheet, for local preview.

This is an APPROXIMATION of the platform importer, good enough to eyeball
show/hide, required-by-role and what ends up in the submission payload. The parts
that matter most are verbatim from the sheet: `additional_component_props JSON`
(col AD) and `customFormIOfield` (col AE) are merged into the component as-is,
and `append_logic` is appended to the component's `logic` array — exactly how the
live form does it.

Usage:
  sheet_to_formio.py --tab Wellness_HRA --section social_history_screening \
      [--out form.json] [--no-cache]

  sheet_to_formio.py --tabs                 list tabs + gid
  sheet_to_formio.py --sections <tab>       list sections of a tab
  sheet_to_formio.py --roles                dump the role vocabulary found in the sheet
"""
import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.request

SHEET_ID = "1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374"
BASE = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
CACHE = os.environ.get("SHEET_CACHE", os.path.join(os.path.dirname(__file__), ".cache"))

# column index -> meaning (see convert-order-service-json-to-csv/scripts/convert.py)
C_DISPLAY_PRIO, C_SECTION_KEY, C_SECTION_NAME, C_LABEL = 1, 2, 3, 4
C_OPT_LABEL, C_PLACEHOLDER, C_DESCRIPTION = 5, 6, 7
C_SALE, C_PSS, C_PROVIDER = 8, 9, 10
C_FIELD_PRIO, C_TYPE, C_KEY, C_INLINE = 12, 13, 14, 15
C_DEFAULT, C_VALUES, C_HTML, C_RELATED = 16, 17, 18, 19
C_ERROR_LABEL, C_AD, C_AE = 28, 29, 30

PERSONAS = {"sale": C_SALE, "pss": C_PSS, "provider": C_PROVIDER}


def fetch(url, path, no_cache=False):
    if not no_cache and os.path.exists(path) and os.path.getsize(path):
        return open(path, encoding="utf-8").read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as fh:
        body = fh.read().decode("utf-8", "replace")
    open(path, "w", encoding="utf-8").write(body)
    return body


def tabs(no_cache=False):
    html = fetch(f"{BASE}/htmlview", f"{CACHE}/index.html", no_cache)
    out = []
    for chunk in html.split("items.push({")[1:]:
        name = re.search(r'name:\s*"([^"]*)"', chunk)
        gid = re.search(r'gid:\s*"(\d+)"', chunk)
        if name and gid:
            out.append((name.group(1).strip(), gid.group(1)))
    return out


def rows_of(tab, no_cache=False):
    hit = [(n, g) for n, g in tabs(no_cache) if n.lower() == tab.lower()] \
        or [(n, g) for n, g in tabs(no_cache) if tab.lower() in n.lower()]
    if not hit:
        sys.exit(f"no tab matches {tab!r} — run --tabs")
    if len(hit) > 1:
        sys.exit(f"{tab!r} is ambiguous: {', '.join(n for n, _ in hit)}")
    name, gid = hit[0]
    body = fetch(f"{BASE}/gviz/tq?tqx=out:csv&gid={gid}", f"{CACHE}/{gid}.csv", no_cache)
    return name, list(csv.reader(io.StringIO(body)))


def cell(row, idx):
    return (row[idx] if len(row) > idx else "").strip()


def parse_json_cell(raw, where):
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception as exc:
        print(f"  ! {where}: invalid JSON, ignored ({exc})", file=sys.stderr)
        return {}


def option_list(raw):
    return [v.strip() for v in raw.split(";") if v.strip()]


def build_component(row, warn):
    ftype = cell(row, C_TYPE)
    key = cell(row, C_KEY)
    if not ftype or not key:
        return None                                  # care-plan grid rows etc.
    label = cell(row, C_LABEL)
    comp = {
        "key": key,
        "type": ftype,
        "input": ftype not in ("content", "htmlelement"),
        "tableView": False,
        "raw_label": label,
        # the live form ships the label pre-wrapped in these spans
        "label": (f"<span class='formio-main-label'>{label}</span> "
                  f"<span class='formio-not-required'>*</span>"
                  f"<div class='formio-optional-label'></div>"),
        "errorLabel": cell(row, C_ERROR_LABEL) or label,
        "display_priority": cell(row, C_FIELD_PRIO),
        "validate": {},
    }
    if cell(row, C_PLACEHOLDER):
        comp["placeholder"] = cell(row, C_PLACEHOLDER)
    if cell(row, C_DESCRIPTION):
        comp["description"] = cell(row, C_DESCRIPTION)
    if cell(row, C_DEFAULT):
        comp["defaultValue"] = cell(row, C_DEFAULT)
    if cell(row, C_INLINE).lower() in ("true", "yes", "1"):
        comp["inline"] = True

    opts = option_list(cell(row, C_VALUES))
    if ftype in ("radio", "selectboxes") and opts:
        comp["values"] = [{"label": o, "value": o, "shortcut": ""} for o in opts]
    elif ftype == "select" and opts:
        comp["dataSrc"] = "values"
        comp["widget"] = "choicesjs"
        comp["data"] = {"values": [{"label": o, "value": o} for o in opts]}
    elif ftype in ("content", "htmlelement"):
        comp["html"] = cell(row, C_HTML) or f"<p>{label}</p>"

    # sheet-authored raw Form.io config — merged verbatim, AD then AE
    ad = parse_json_cell(cell(row, C_AD), f"{key} col AD")
    ae = parse_json_cell(cell(row, C_AE), f"{key} col AE")
    append_logic = []
    for src, name in ((ad, "AD"), (ae, "AE")):
        for k, v in src.items():
            if k == "append_logic":
                append_logic.extend(v)
                continue
            if k == "validate" and isinstance(v, dict):
                comp["validate"].update(v)
                continue
            comp[k] = v
    if append_logic:
        comp["logic"] = append_logic          # role arms are added later, per persona

    # role config straight from the sheet's three permission columns
    comp["_perm"] = {p: cell(row, idx).upper() for p, idx in PERSONAS.items()}
    if not any(comp["_perm"].values()):
        warn.append(f"{key}: no role config in Sale/PSS/Provider")
    return comp


def build_form(tab, section, no_cache=False):
    name, rows = rows_of(tab, no_cache)
    warn = []
    comps, skipped = [], []
    section_name = None
    for row in rows[1:]:
        if cell(row, C_SECTION_KEY).lower() != section.lower():
            continue
        section_name = section_name or cell(row, C_SECTION_NAME)
        comp = build_component(row, warn)
        (comps.append(comp) if comp else skipped.append(cell(row, C_KEY) or "(no key)"))
    if not comps:
        sys.exit(f"no rows with Section key == {section!r} in {name} — run --sections {name!r}")

    def prio(c):
        try:
            return int(c.get("display_priority") or 10**6)
        except ValueError:
            return 10**6
    comps.sort(key=prio)

    return {
        "title": f"{name} · {section_name or section}",
        "name": section,
        "display": "form",
        "components": comps,
        "_meta": {
            "tab": name, "section_key": section, "section_name": section_name,
            "field_count": len(comps), "skipped_rows": skipped, "warnings": warn,
        },
    }


def role_vocabulary(no_cache=False):
    """Every role token the sheet's own JS mentions, plus the permission values."""
    tokens, perms = {}, {}
    rx = re.compile(r"(?:window\.role|window\.config_role_name)\s*[=!]==?\s*'([^']+)'")
    for name, _gid in tabs(no_cache):
        try:
            _n, rows = rows_of(name, no_cache)
        except SystemExit:
            continue
        for row in rows[1:]:
            for idx in (C_AD, C_AE):
                for tok in rx.findall(cell(row, idx)):
                    tokens.setdefault(tok, set()).add(name)
            for p, idx in PERSONAS.items():
                v = cell(row, idx).upper()
                if v:
                    perms.setdefault(p, {}).setdefault(v, 0)
                    perms[p][v] += 1
    return tokens, perms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tabs", action="store_true")
    ap.add_argument("--sections")
    ap.add_argument("--roles", action="store_true")
    ap.add_argument("--tab")
    ap.add_argument("--section")
    ap.add_argument("--out")
    ap.add_argument("--no-cache", action="store_true")
    a = ap.parse_args()

    if a.tabs:
        for name, gid in tabs(a.no_cache):
            print(f"{gid:>12}  {name}")
        return
    if a.sections:
        name, rows = rows_of(a.sections, a.no_cache)
        seen = {}
        for row in rows[1:]:
            k = cell(row, C_SECTION_KEY)
            if k:
                seen.setdefault(k, [0, cell(row, C_SECTION_NAME)])
                seen[k][0] += 1
        print(f"{name}:")
        for k, (n, label) in seen.items():
            print(f"  {n:>3}  {k:<42} {label}")
        return
    if a.roles:
        tokens, perms = role_vocabulary(a.no_cache)
        print("window.role / window.config_role_name values used in sheet JS:")
        for tok, where in sorted(tokens.items()):
            print(f"  {tok:<28} ({len(where)} tab: {', '.join(sorted(where)[:3])})")
        print("\npermission values per column:")
        for p, vals in perms.items():
            print(f"  {p:<9} " + ", ".join(f"{v}×{n}" for v, n in sorted(vals.items())))
        return
    if not (a.tab and a.section):
        ap.error("need --tab and --section (or --tabs / --sections / --roles)")

    form = build_form(a.tab, a.section, a.no_cache)
    out = a.out or os.path.join(os.path.dirname(__file__), "form.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(form, fh, ensure_ascii=False, indent=1)
    m = form["_meta"]
    print(f"{out}: {m['field_count']} field(s) from [{m['tab']}] {m['section_key']}")
    if m["skipped_rows"]:
        print(f"  skipped (no type/key): {', '.join(m['skipped_rows'])}")
    for w in m["warnings"]:
        print(f"  warn: {w}")


if __name__ == "__main__":
    main()
