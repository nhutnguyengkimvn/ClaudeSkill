# Workflow 01 — Detect PDF Type & Fetch Form.io Keys

> Detects the test type + lab from the PDF, then finds the matching
> Form.io order-services form and reads all its component keys.

## Step 1 — Detect test type + lab from PDF

Reuse the same detection logic as `import-lab-recform`:

```bash
~/.claude/skills/.venv/bin/python3 \
  "/Users/nhut/Documents/GKIM/Document Skill AI/.claude/skills/import-lab-recform/scripts/detect-recform-type.py" \
  "<PDF_PATH>"
```

- Map result to Short Code + Lab using
  `import-lab-recform/references/abbreviation-map.md`.
- If detection is uncertain → show PAGE 1 TEXT, ask user to confirm Short Code
  and Lab before continuing.

Derive:
- `<SHORT_CODE>` e.g. `METABOLIC`
- `<LAB>` e.g. `Amedix`
- `<FORM_TITLE_SEARCH>` = `order services <SHORT_CODE> <LAB>` (used to search the
  Form.io builder list). Example: `order services Metabolic Amedix`.

## Step 2 — Find the matching Form.io order-services form

1. Navigate to `<DASHBOARD_URL>/admin/formio-dev-builder/`.
2. Use the search/filter box to search for `<FORM_TITLE_SEARCH>`.
3. Take a `browser_snapshot` to read the results list.
4. Identify the correct form — it should contain `[ENV]` tag + `[AI]` +
   `order services` + the lab name. Example:
   `[DEV] [AI] order services Metabolic Amedix`.
5. If multiple results → show them to user and ask to confirm which one.
6. If no result → try searching only by Short Code, then by Lab. If still none
   found → report `❌ No matching Form.io form found for <FORM_TITLE_SEARCH>`
   and STOP.

## Step 3 — Get the Firebase schema URL

1. Click the matching form to open its builder page.
2. Open the **JSON editor / Monaco editor** (usually a button labelled "Edit JSON"
   or "Schema" in the builder toolbar).
3. Read the form's **ID** from the URL:
   `<DASHBOARD_URL>/admin/formio-dev-builder/<FORM_ID>/` → extract `<FORM_ID>`.
4. The Firebase schema URL is:
   ```
   https://dev-rce-dashboard.firebaseio.com/forms/<FORM_ID>/schema.json
   ```
   (Always uses `dev-rce-dashboard.firebaseio.com`, regardless of the
   dashboard environment.)

Alternatively, if the form builder page has a direct Monaco editor, use
`browser_evaluate` to read the schema:
```javascript
window.monaco.editor.getModels()[0].getValue()
```
Save the raw JSON to `/tmp/fill-key-schema-<SHORT_CODE>.json`.

## Step 4 — Extract all component keys

Fetch the schema (either from Firebase URL via `browser_navigate` and reading
the page source, or from the saved `/tmp/` file), then recursively collect
every component key:

```bash
~/.claude/skills/.venv/bin/python3 - <<'EOF'
import json, sys

def collect_keys(components, result=None):
    if result is None:
        result = []
    for c in (components or []):
        k = c.get("key")
        t = c.get("type", "")
        if k and t not in ("button", "content", "htmlelement"):
            result.append({"key": k, "type": t, "label": c.get("label", "")})
        # recurse into nested containers
        collect_keys(c.get("components", []), result)
        for col in c.get("columns", []):
            collect_keys(col.get("components", []), result)
        collect_keys(c.get("rows", []), result)
    return result

with open("/tmp/fill-key-schema-SHORTCODE.json") as f:
    schema = json.load(f)

keys = collect_keys(schema.get("components", []))
for item in keys:
    print(f"{item['type']:20s} {item['key']:60s} {item['label']}")
EOF
```

Adapt `SHORTCODE` in the filename to match Step 3. Capture the output — this is
the raw Form.io key list passed to Workflow 02.

## Step 5 — Detect ICD code mode

After collecting keys, scan the schema for diagnosis / ICD components to
determine whether the form uses **per-panel** or **global** ICD mode.
Read `references/field-type-rules.md` § 4 for full rules.

**Per-panel detection signals (ANY of these):**
- A `selectboxes` component whose key contains `diagnosis` or `icd` AND has a
  `customConditional` referencing a panel value.
- Multiple separate diagnosis components, each tied to a different panel
  (one per panel's conditional block).

**Global detection signals:**
- A single `selectboxes` component with key like `order_service_diagnosis_icd10`
  or `diagnoses` that has NO panel-specific `customConditional`.
- Only one diagnosis block in the whole schema.

**Collect ICD data:**
- Extract ALL ICD codes from the diagnosis `selectboxes` values:
  `{ value: "B20", label: "Human immunodeficiency virus [HIV] disease" }`
- For per-panel: also collect the `order_service_test_panel` selectboxes values
  (these become the `<panel_value>` in the key name).

Store:
```
icd_mode = "per-panel" | "global"
panel_values = ["METACORE-Dx | PCR/MLPA …", …]  # only for per-panel
icd_codes = ["B20", "F32.1", …]
```

## Step 6 — Report detection result

Show the user:
```
Detected: <SHORT_CODE> / <LAB>
Form.io form: <FORM_DISPLAY_TITLE> (ID: <FORM_ID>)
Schema URL: https://dev-rce-dashboard.firebaseio.com/forms/<FORM_ID>/schema.json
Keys found: N components

ICD mode: per-panel (N panels) | global
ICD codes: N codes
```

Then proceed to Workflow 02.
