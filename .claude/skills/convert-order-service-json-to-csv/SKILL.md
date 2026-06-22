---
name: convert-order-service-json-to-csv
description: >
  Convert a Form.io form definition (JSON) into the DNAi Req-Form mapping CSV.
  Use whenever the user provides a Form.io form JSON (components array with
  type/key/label/conditional/customConditional...) and wants it mapped to the
  DNAi import sheet: one row per component, fixed "Test Requirements" section,
  role columns, Values joined by ';', and conditions emitted into the
  "additional_component_props JSON" column. Triggers: "map this form JSON to
  CSV", "convert Form.io to the req-form sheet", "generate the order services CSV".
---

# Form.io → DNAi Req-Form CSV

## What it does
Reads a Form.io form JSON and writes a CSV that matches the DNAi mapping sheet
(34-column layout). **One Form.io component = one CSV row.** Nested components
inside `datagrid`/`container`/`columns`/`table` are walked recursively and also
get their own rows.

## How to run
```bash
python3 scripts/convert.py INPUT.json OUTPUT.csv
```
Optional flags (defaults shown):
```bash
--section-key test_requirements      # "Section key" column
--section-name "Test Requirements"   # "Section Name" column (fixed)
--section-priority 8                 # "Display priority" column (whole section)
--sale VIEW  --pss VIEW  --provider VIEW
```
Output is UTF-8 **with BOM** so Excel / Numbers open it with correct accents.

## Workflow (IMPORTANT — always follow in exact order)

**Step 1 — Ask for the schema link (always stop and ask first; do nothing else until you have the link):**
> *"Please provide the JSON schema link for the form."*

**Step 2 — Fetch the JSON:** when the user provides the link (e.g.
`https://dev-rce-dashboard.firebaseio.com/forms/-Oukz3CkVsFGUgKcAHqa/schema.json`),
use **WebFetch** to download it, then save the JSON to a file (e.g. `/tmp/form.json`).
(Firebase links cannot be fetched directly by the container — use Claude's WebFetch
then write to file; the script only reads from a local file.)

**Step 3 — First run (WITHOUT `--schema-url`):**
```bash
python3 scripts/convert.py /tmp/form.json OUTPUT.csv
```
- If the form **has no datagrid** → CSV is produced immediately. Done.
- If **datagrids are found** → script exits with code 2 and prints to stderr:
  `DATAGRID_FOUND: N datagrid. Need JSON link for fields: <key1>, <key2>...`

**Step 4 — Ask for a link per datagrid:** when `DATAGRID_FOUND` appears, **stop and ask**:
> *"Found datagrid `<key>`. Please provide the JSON link for this field."*
(Ask one at a time for each datagrid the script lists.)

**Step 5 — Second run with datagrid links** (repeat `--datagrid-link` in the exact
field order the script listed):
```bash
python3 scripts/convert.py /tmp/form.json OUTPUT.csv \
    --datagrid-link "https://.../schema/components/15.json"
```
Each datagrid produces **1 `__json__` row**: skip=`__json__`,
Sale/PSS/Provider=VIEW, link placed in the **JSON** column, child fields not expanded.

> Note: the script also supports `--schema-url` to auto-derive datagrid links
> (`.../schema/components/{index}.json`) if you want to skip the ask step, but the
> current convention is to **always ask** per-datagrid (do not use `--schema-url`).

## Mapping rules

| CSV column | Source from Form.io component |
|---|---|
| Display priority | constant `--section-priority` (default 8) |
| Section key / Section Name | fixed `test_requirements` / `Test Requirements` |
| Label | `component.label` |
| Placeholder | `component.placeholder` |
| Description | `component.description` |
| Sale / PSS / Provider | `VIEW` / `VIEW` / `VIEW` (override with flags) |
| Field's display priority | auto-incremented 1, 2, 3… in traversal order |
| Field Type | `component.type` (raw Form.io type); `htmlelement` → emit `content` |
| field_key | replace prefix `order_service_` → `test_requirements_`; keys missing `test_requirements` prefix get it added; duplicates get suffix (`_2`, `_3`…) |
| Inline | always blank |
| Default Value | `component.defaultValue` if it is a plain scalar (string/number); object/bool/list → blank |
| Values | `select` (static) / `selectboxes` / `radio`: join **value** with `;` |
| HTML Content | `component.content` when `type === "htmlelement"` |
| Error Label | `component.errorLabel` |
| additional_component_props JSON | conditions (see below) |

**Skip entirely** (no row emitted): `type: "hidden"`, `hidden: true` components
(including hidden datagrids and all their children), and the submit button
(`type: "button"` + `action: "submit"`).

All other columns (Optional Label, Related Fields, CONDITIONAL VALUE, JSON, ROLE
CONFIG, INCLUDE/EXCLUDE ONLY, CASE STATE PERMS, ENV, HTML5 Label,
customFormIOfield) are left **blank** — no clear mapping source; fill manually if needed.

## Conditions → `additional_component_props JSON` column

Emitted in this exact format:
```json
{"conditional": {"show": true, "when": "<field_key with converted prefix>", "eq": "<value>"}}
```
Two sources handled:
1. **Standard `conditional` object** `{show, when, eq}` → mapped directly (prefix converted on `when`).
2. **Simple `customConditional` JS** of the form `show = data.<key> === 'X';`
   (accepts `==`/`===`, single or double quotes) → parsed into `{show, when, eq}`.

**Skipped (column left blank)** for all complex expressions: those containing `!`,
`&&`, `||`, `row.`, ternary `?`, or `+`. For example `show = !data.x` and
`show = (row.medication && row.medication.value === 'Other')` → blank.
→ Review these rows manually and fill in if the form requires them.

## Notes / assumptions
- **Dynamic values** (`dataSrc: url`/`custom`/`resource`) have no static option list →
  Values column is blank (populated at runtime).
- **field_key prefix change also affects `when`**: if the form references keys via
  `calculateValue`/`refreshOn`/`customConditional`, update those references in the
  target system after the prefix rename to keep them consistent.
- Keys without the `order_service_` prefix (e.g. `html`, `submit`,
  already-prefixed `test_requirements_*` keys, and datagrid child fields like
  `medication`) are kept as-is.
- `validate.required` is **not** emitted into the CSV (the template column only
  holds `conditional`). Extend `build_conditional()` if required later.
