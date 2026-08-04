#!/usr/bin/env python3
"""Query the Core platform field-mapping Google Sheet.

The sheet is the source of truth for every chart form field: section, label,
field_key, field type, values, role config. It is link-readable, so the tabs can
be pulled as CSV without auth — which means field lookups are a deterministic
grep, not an eyeball over a screenshot.

Usage:
  core-sheet.py --tabs                          list every tab and its gid
  core-sheet.py --sections <tab>                list the sections inside a tab
  core-sheet.py --find <regex> [--tab <tab>]    find fields (all tabs if --tab omitted)
  core-sheet.py --section <name> --tab <tab>    dump every field of one section, in order

<tab> is a tab name (case-insensitive, substring ok) or a raw gid.
Add --raw to print the full CSV row instead of the summary.
"""
import argparse
import csv
import io
import os
import re
import sys
import urllib.request

SHEET_ID = "1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
CACHE = os.environ.get("CORE_SHEET_CACHE", "/tmp/core-sheet-cache")
SUMMARY_COLS = ["Section Name", "field_key", "Field Type", "Label", "Placeholder",
                "Values", "Default Value", "Related Fields", "CONDITIONAL VALUE", "JSON"]


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return open(path, encoding="utf-8").read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as fh:
        body = fh.read().decode("utf-8", "replace")
    open(path, "w", encoding="utf-8").write(body)
    return body


def tabs():
    """[(name, gid)] parsed from the htmlview page, so new tabs are picked up."""
    html = get(f"{SHEET_URL}/htmlview", f"{CACHE}/index.html")
    out = []
    for chunk in html.split("items.push({")[1:]:
        name = re.search(r'name:\s*"([^"]*)"', chunk)
        gid = re.search(r'gid:\s*"(\d+)"', chunk)
        if name and gid:
            out.append((name.group(1).strip(), gid.group(1)))
    return out


def resolve(tab):
    if re.fullmatch(r"\d+", tab or ""):
        return tab, tab
    for name, gid in tabs():
        if name.lower() == tab.lower():
            return name, gid
    hits = [(n, g) for n, g in tabs() if tab.lower() in n.lower()]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        sys.exit(f"no tab matches {tab!r}. Run --tabs to list them.")
    sys.exit(f"{tab!r} is ambiguous: {', '.join(n for n, _ in hits)}")


def rows_of(tab):
    name, gid = resolve(tab)
    body = get(f"{SHEET_URL}/gviz/tq?tqx=out:csv&gid={gid}",
               f"{CACHE}/{gid}.csv")
    return name, list(csv.DictReader(io.StringIO(body)))


def val(row, col):
    return (row.get(col) or "").strip()


def show(tab_name, row, raw=False):
    if raw:
        print({k: v for k, v in row.items() if (v or "").strip()})
        return
    print(f"[{tab_name}] [{val(row,'Section Name') or '-'}] {val(row,'field_key') or '(no key)'}"
          f"  type={val(row,'Field Type') or '-'}")
    for col in ["Label", "Placeholder", "Values", "Default Value", "Related Fields",
                "CONDITIONAL VALUE", "JSON"]:
        if val(row, col):
            print(f"      {col:<18} {val(row, col)[:160]}")
    roles = [c for c in ["Sale ", "PSS", "Provider"] if val(row, c)]
    if roles:
        print(f"      {'roles':<18} " + ", ".join(f"{c.strip()}={val(row,c)}" for c in roles))


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--tabs", action="store_true")
    ap.add_argument("--sections")
    ap.add_argument("--find")
    ap.add_argument("--section")
    ap.add_argument("--tab")
    ap.add_argument("--raw", action="store_true")
    a = ap.parse_args()

    if a.tabs:
        for name, gid in tabs():
            print(f"{gid:>12}  {name}")
        return

    if a.sections:
        name, rows = rows_of(a.sections)
        seen = []
        for r in rows:
            s = val(r, "Section Name")
            if s and s not in seen:
                seen.append(s)
        print(f"{name}: {len(rows)} rows")
        for s in seen:
            n = sum(1 for r in rows if val(r, "Section Name") == s)
            print(f"  {n:>3}  {s}")
        return

    if a.section:
        if not a.tab:
            sys.exit("--section needs --tab")
        name, rows = rows_of(a.tab)
        hit = [r for r in rows if val(r, "Section Name").lower() == a.section.lower()]
        if not hit:
            hit = [r for r in rows if a.section.lower() in val(r, "Section Name").lower()]
        for r in hit:
            show(name, r, a.raw)
        print(f"\n{len(hit)} field(s) in section {a.section!r} of {name}")
        return

    if a.find:
        rx = re.compile(a.find, re.I)
        targets = [a.tab] if a.tab else [n for n, _ in tabs()]
        total = 0
        for t in targets:
            name, rows = rows_of(t)
            for r in rows:
                blob = " ".join(val(r, c) for c in SUMMARY_COLS)
                if rx.search(blob):
                    show(name, r, a.raw)
                    total += 1
        print(f"\n{total} match(es) for /{a.find}/" + (f" in {a.tab}" if a.tab else " across all tabs"))
        return

    ap.print_help()


if __name__ == "__main__":
    main()
