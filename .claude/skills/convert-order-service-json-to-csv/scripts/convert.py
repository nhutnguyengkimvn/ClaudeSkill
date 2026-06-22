#!/usr/bin/env python3
"""
Convert a Form.io form definition (JSON) into the DNAi Req-Form CSV template.

Each Form.io component -> one CSV row. Layout/nested components are walked
recursively so nested fields (datagrid/container/columns) also produce rows.

Usage:
    python3 convert.py INPUT.json OUTPUT.csv \
        [--section-key test_requirements] \
        [--section-name "Test Requirements"] \
        [--section-priority 8] \
        [--sale VIEW] [--pss VIEW] [--provider VIEW]
"""
import argparse
import json
import re
import csv
import sys

# Exact header of the DNAi mapping sheet (col 0 is an unused leading column).
HEADER = [
    "",                                  # 0  (unused/leading)
    "Display priority",                  # 1
    "Section key",                       # 2
    "Section Name",                      # 3
    "Label",                             # 4
    "Optional Label",                    # 5
    "Placeholder",                       # 6
    "Description",                       # 7
    "Sale ",                             # 8  (trailing space matches template)
    "PSS",                               # 9
    "Provider",                          # 10
    "Case State to enable",              # 11
    "Field's display priority",          # 12
    "Field Type",                        # 13
    "field_key",                         # 14
    "Inline",                            # 15
    "Default Value",                     # 16
    "Values",                            # 17
    "HTML Content",                      # 18
    "Related Fields",                    # 19
    "CONDITIONAL VALUE",                 # 20
    "JSON",                              # 21
    "ROLE CONFIG",                       # 22
    "INCLUDE ONLY",                      # 23
    "EXCLUDE ONLY",                      # 24
    "CASE STATE PERMS",                  # 25
    "ENV",                               # 26
    "HTML5 Label",                       # 27
    "Error Label",                       # 28
    "additional_component_props JSON",   # 29
    "customFormIOfield",                 # 30
]

# Form.io types that are pure layout/decoration but still emitted (user: keep all).
# We still recurse into their children.
CONTAINER_TYPES = {"datagrid", "editgrid", "container", "columns",
                   "panel", "fieldset", "well", "table", "tabs", "tree"}

OLD_PREFIX = "order_service_"


def base_convert_key(key):
    """Normalise key to test_requirements_ prefix (no dedup).
    Used for 'when' in conditions so it points to the correct original field key."""
    if not key:
        return "test_requirements_field"
    if key.startswith(OLD_PREFIX):
        return "test_requirements_" + key[len(OLD_PREFIX):]
    if key.startswith("test_requirements"):
        return key
    return "test_requirements_" + key


def unique_key(key, used_keys):
    """base_convert_key + guarantee uniqueness: duplicates get _2, _3... suffix."""
    base = base_convert_key(key)
    new = base
    n = 1
    while new in used_keys:
        n += 1
        new = f"{base}_{n}"
    used_keys.add(new)
    return new


def convert_key(key, new_prefix=None):
    """Keep backward-compat for old callers (build_conditional uses base)."""
    return base_convert_key(key)


def scalar_default(val):
    """Return defaultValue only if it is a simple, non-empty scalar."""
    if val is None:
        return ""
    if isinstance(val, (str, int, float)) and not isinstance(val, bool):
        return str(val).strip()
    return ""  # objects (selectboxes maps), bools, lists -> blank


def extract_values(comp):
    """Join option values with ';' (value only) for select/selectboxes/radio."""
    vals = []
    data = comp.get("data") or {}
    src = comp.get("dataSrc")
    # selectboxes / radio keep options under top-level "values"
    if isinstance(comp.get("values"), list):
        vals = comp["values"]
    # select with static values keeps them under data.values
    elif isinstance(data.get("values"), list):
        vals = data["values"]

    out = []
    for v in vals:
        if not isinstance(v, dict):
            continue
        value = v.get("value", "")
        if value == "" and v.get("label", "") == "":
            continue  # skip the empty placeholder entry url-sources leave behind
        out.append(str(value))
    if out:
        return ";".join(out)

    # Dynamic sources (url / custom JS) have no static option list.
    if src in ("url", "custom", "resource") or data.get("url") or data.get("custom"):
        return ""  # leave blank; populated at runtime
    return ""


def build_conditional(comp, new_prefix):
    """Return the additional_component_props JSON string, or '' if none.

    Handles two forms:
      1. conditional object: {show, when, eq}
      2. customConditional simple JS:  show = data.<key> === 'X';
    Complex customConditional (negation, row.*, &&, etc.) -> '' (skipped).
    """
    # 1) standard conditional object
    cond = comp.get("conditional") or {}
    show = cond.get("show")
    when = cond.get("when")
    eq = cond.get("eq")
    if when and show is not None:
        obj = {"conditional": {
            "show": bool(show),
            "when": base_convert_key(when),
            "eq": eq if eq is not None else "",
        }}
        return json.dumps(obj, ensure_ascii=False)

    # 2) customConditional simple equality
    cc = (comp.get("customConditional") or "").strip()
    if cc:
        # show = data.KEY === 'VALUE';   (also tolerate "==", double quotes)
        m = re.search(
            r"""show\s*=\s*data\.([A-Za-z0-9_]+)\s*={2,3}\s*['"]([^'"]+)['"]""",
            cc,
        )
        # bail out if the expression is compound (negation, &&, ||, row., ternary)
        compound = any(tok in cc for tok in ("!", "&&", "||", "row.", "?", "+"))
        if m and not compound:
            obj = {"conditional": {
                "show": True,
                "when": base_convert_key(m.group(1)),
                "eq": m.group(2),
            }}
            return json.dumps(obj, ensure_ascii=False)
    return ""


def make_row(comp, opts, field_priority, used_keys):
    t = comp.get("type", "")
    row = [""] * len(HEADER)
    row[1] = opts.section_priority
    row[2] = opts.section_key
    row[3] = opts.section_name
    row[4] = comp.get("label", "") or ""
    row[6] = comp.get("placeholder", "") or ""
    row[7] = comp.get("description", "") or ""
    row[8] = opts.sale
    row[9] = opts.pss
    row[10] = opts.provider
    row[12] = field_priority
    row[13] = "content" if t == "htmlelement" else t  # Field Type
    row[14] = unique_key(comp.get("key"), used_keys)
    row[15] = ""  # Inline: always blank per spec
    row[16] = scalar_default(comp.get("defaultValue"))
    row[17] = extract_values(comp)
    row[18] = comp.get("content", "") or "" if t == "htmlelement" else ""
    row[28] = comp.get("errorLabel", "") or ""
    row[29] = build_conditional(comp, opts.section_key)
    return row


def make_json_row(opts, field_priority, link):
    """Reference row for an external JSON datagrid (per CSV template).

    __skip__ = __json__; Sale/PSS/Provider = VIEW; link goes in the JSON column.
    All other columns blank.
    """
    row = [""] * len(HEADER)
    row[0] = "__json__"
    row[1] = opts.section_priority
    row[2] = opts.section_key
    row[3] = opts.section_name
    row[8] = opts.sale          # VIEW
    row[9] = opts.pss           # VIEW
    row[10] = opts.provider     # VIEW
    row[12] = field_priority
    row[21] = link              # JSON column
    return row


def count_datagrids(components):
    """Count datagrid components (recursive)."""
    return len(list_datagrids(components))


def list_datagrids(components):
    """Return list of datagrid keys (recursive, does not descend into datagrids)."""
    out = []
    for comp in components:
        if not isinstance(comp, dict):
            continue
        if comp.get("type") == "datagrid":
            out.append(comp.get("key", "(no key)"))
            continue
        for child in _child_lists(comp):
            out.extend(list_datagrids(child))
    return out


def _child_lists(comp):
    """Return all child component arrays (components/columns/rows)."""
    out = []
    if isinstance(comp.get("components"), list):
        out.append(comp["components"])
    if isinstance(comp.get("columns"), list):
        for col in comp["columns"]:
            if isinstance(col, dict) and isinstance(col.get("components"), list):
                out.append(col["components"])
    if isinstance(comp.get("rows"), list):
        for r in comp["rows"]:
            if isinstance(r, list):
                for cell in r:
                    if isinstance(cell, dict) and isinstance(cell.get("components"), list):
                        out.append(cell["components"])
    return out


def walk(components, opts, rows, counter, links, used_keys, depth=0):
    for i, comp in enumerate(components):
        if not isinstance(comp, dict):
            continue
        # DATAGRID: do not expand children; emit one __json__ row with its link
        if comp.get("type") == "datagrid":
            link = ""
            if depth == 0 and opts.schema_base:
                # auto-derive: .../schema + /components/{top-level index}.json
                link = f"{opts.schema_base}/components/{i}.json"
            else:
                idx = links["i"]
                if idx < len(links["urls"]):
                    link = links["urls"][idx]
                links["i"] += 1
            counter[0] += 1
            rows.append(make_json_row(opts, counter[0], link))
            continue
        # Skip: type "hidden", hidden:true components, and submit button
        if comp.get("type") == "hidden":
            continue
        if comp.get("hidden") is True:
            continue
        if comp.get("type") == "button" and comp.get("action") == "submit":
            continue
        counter[0] += 1
        rows.append(make_row(comp, opts, counter[0], used_keys))
        # recurse into nested children
        for child in _child_lists(comp):
            walk(child, opts, rows, counter, links, used_keys, depth + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--section-key", default="test_requirements")
    ap.add_argument("--section-name", default="Test Requirements")
    ap.add_argument("--section-priority", default="8")
    ap.add_argument("--sale", default="VIEW")
    ap.add_argument("--pss", default="VIEW")
    ap.add_argument("--provider", default="VIEW")
    ap.add_argument("--schema-url", default="",
                    help="Original schema.json URL (e.g. .../schema.json). Used to "
                         "auto-derive datagrid links: .../schema/components/{index}.json")
    ap.add_argument("--datagrid-link", action="append", default=[],
                    help="JSON link for a datagrid (fallback when --schema-url is absent).")
    opts = ap.parse_args()
    # base for building datagrid links: strip trailing .json from schema-url
    opts.schema_base = re.sub(r"\.json$", "", opts.schema_url) if opts.schema_url else ""

    with open(opts.input, encoding="utf-8") as f:
        form = json.load(f)
    components = form.get("components", form if isinstance(form, list) else [])

    # Pre-scan: if datagrids exist but not enough links supplied -> exit and request links
    dg_keys = list_datagrids(components)
    n_dg = len(dg_keys)
    if n_dg and not opts.schema_base and n_dg > len(opts.datagrid_link):
        remaining = dg_keys[len(opts.datagrid_link):]
        print(f"DATAGRID_FOUND: {n_dg} datagrid. "
              f"Need JSON link for fields: {', '.join(remaining)}", file=sys.stderr)
        sys.exit(2)

    links = {"urls": opts.datagrid_link, "i": 0}
    used_keys = set()
    rows = []
    walk(components, opts, rows, [0], links, used_keys)

    with open(opts.output, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)

    print(f"Wrote {len(rows)} rows -> {opts.output}"
          + (f" ({n_dg} datagrid -> __json__ rows)" if n_dg else ""))


if __name__ == "__main__":
    main()
