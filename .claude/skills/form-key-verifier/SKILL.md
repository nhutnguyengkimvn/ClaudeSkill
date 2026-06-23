---
name: form-key-verifier
description: Visually verify and auto-correct form field key assignments. Pre-filters the key list using PDF text extraction before visual verification to dramatically reduce reasoning load.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
argument-hint: "--keys <key.json> --pdf <form.pdf> --assigned <assigned.json> [--output <out.json>]"
---

# Form Key Verifier (v2 — optimized)

Verify and correct key assignments in an assigned JSON by visually reading the PDF.

**Performance approach:**
1. Pre-filter the key list via text extraction → only pass plausible keys to Claude vision
2. Merge PDF read + visual verification into one pass (no separate "read then analyze")
3. Output compact JSON corrections directly — no verbose table narration

## Usage

```
/form-key-verifier --keys data/CGX_Amedix/key.json --pdf "pdf_raw/CGX rec_Amedix.pdf" --assigned data/CGX_Amedix/amedix_cgx.json
```

Optional: `--output data/CGX_Amedix/amedix_cgx_fixed.json` (default: overwrite `--assigned`)

---

## Execution Steps

### Step 1 — Parse arguments

Extract from the skill args:
- `--keys` → path to `key.json`
- `--pdf` → path to raw PDF
- `--assigned` → path to assigned JSON
- `--output` → output path (default: same as `--assigned`)

### Step 2 — Load data + pre-filter keys

Run this single script — it loads data AND filters the key list to only keys plausible for this PDF:

```bash
python3 - <<'PYEOF'
import json, sys

try:
    import pdfplumber
except ImportError:
    import subprocess; subprocess.run([sys.executable, "-m", "pip", "install", "pdfplumber", "-q"])
    import pdfplumber

keys_path   = "<keys>"
pdf_path    = "<pdf>"
assigned_path = "<assigned>"

keys     = json.load(open(keys_path, encoding="utf-8"))
assigned = json.load(open(assigned_path, encoding="utf-8"))

# Extract all text from PDF
pdf_text = ""
with pdfplumber.open(pdf_path) as pdf:
    for page in pdf.pages:
        t = page.extract_text() or ""
        pdf_text += t.lower()

def key_plausible(key):
    """Return True if any meaningful token from the key appears in PDF text."""
    # Always keep short admin keys
    always_keep = {"order_", "patient_", "network_", "insurance_", "diagnosis_additional",
                   "signature_", "datesignature_"}
    for prefix in always_keep:
        if key.startswith(prefix):
            return True
    # For longer keys, check if a meaningful substring appears in PDF text
    # Strip common prefixes to get the label part
    for prefix in ("personal_cancer_", "family_cancer_", "testing_criteria_",
                   "order_panel_", "diagnosis_icd10codes__"):
        if key.startswith(prefix):
            label = key[len(prefix):].lower()
            # Check a 6+ char token from the label
            tokens = [t for t in label.replace("_", " ").split() if len(t) >= 5]
            return any(t in pdf_text for t in tokens)
    # Fallback: check key itself
    return key.lower().replace("_", " ") in pdf_text or key.lower() in pdf_text

filtered = [k for k in keys if key_plausible(k)]
unique_filtered = list(dict.fromkeys(filtered))  # deduplicate, preserve order

print(f"Keys total: {len(keys)}  →  Filtered for this PDF: {len(unique_filtered)}")
print(f"\nFiltered key list:")
for k in unique_filtered:
    print(f"  {k}")

print(f"\nCurrent field assignments ({len(assigned)} fields):")
for i, a in enumerate(assigned):
    print(f"  {i} p{a['page']} {a['subject'][:2]} {a['contents']}")
PYEOF
```

This prints:
- Filtered key list (keys plausible for this specific PDF)
- All current field assignments

Use the **filtered key list** (not the full key.json) for visual verification in Step 3.

### Step 3 — Read PDF + verify in one pass

Read each page of the PDF and immediately cross-reference with the field assignments.
Use the `Read` tool for each page:

```
Read <pdf>  pages: "1"
```

While reading page N, immediately perform visual verification for all fields on that page:

**For each field on the page:**
1. Identify the field visually (textbox = rectangle, checkbox = small square)
2. Read surrounding text to determine what it represents (look all directions)
3. Match to the filtered key list — only flag if the current assignment is **wrong or missing**
4. If the field has no relevant key → skip (leave unassigned)

**Rules:**
- Correct assignment → skip entirely (no output needed)
- Wrong/missing assignment + clear match → record correction
- Unsure → leave as-is (do not guess)
- 1-to-1 constraint: note if a key move displaces another field (will be handled in Step 4 script)
- Numeric placeholders (`0_N`, `1_N`) = unassigned, assign if key clearly matches

**After reading all pages**, output corrections as a compact JSON array only — no narration:

```json
[
  {"field_index": 3, "key": "order_provider_network"},
  {"field_index": 10, "key": ""},
  {"field_index": 22, "key": "patient_first_name"}
]
```

`"key": ""` means unassign. Only include fields that need a change.

### Step 4 — Apply corrections

```bash
python3 - <<'PYEOF'
import json

assigned_path = "<assigned>"
keys_path     = "<keys>"
output_path   = "<output>"  # same as assigned if no --output

assigned = json.load(open(assigned_path, encoding="utf-8"))
keys     = json.load(open(keys_path, encoding="utf-8"))
key_set  = set(keys)

corrections = [
    # PASTE the JSON array from Step 3 here
]

key_to_fi = {ann["contents"]: fi for fi, ann in enumerate(assigned) if ann["contents"] in key_set}

for c in corrections:
    fi      = c["field_index"]
    new_key = c["key"]
    if new_key and new_key not in key_set:
        print(f"  SKIP {fi}: '{new_key}' not in key list")
        continue
    if new_key and new_key in key_to_fi and key_to_fi[new_key] != fi:
        old_fi = key_to_fi[new_key]
        assigned[old_fi]["contents"] = ""
        del key_to_fi[new_key]
        print(f"  Freed {old_fi} (was {new_key})")
    old_key = assigned[fi]["contents"]
    if old_key in key_to_fi and key_to_fi[old_key] == fi:
        del key_to_fi[old_key]
    assigned[fi]["contents"] = new_key
    if new_key:
        key_to_fi[new_key] = fi
    print(f"  {fi}: '{old_key}' → '{new_key or '(unassigned)'}'")

json.dump(assigned, open(output_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"\nSaved → {output_path}")
PYEOF
```

### Step 5 — Check undetected fields

```bash
python3 - <<'PYEOF'
import json
keys     = json.load(open("<keys>"))
assigned = json.load(open("<output>"))
used     = {a["contents"] for a in assigned}
unique_keys = list(dict.fromkeys(keys))
missing  = [k for k in unique_keys if k not in used]
print(f"Keys with no annotation: {len(missing)} / {len(unique_keys)}")
for k in missing:
    print(f"  - {k}")
PYEOF
```

### Step 6 — Report

```
Total fields: N  |  Assigned: M  |  Unassigned: K
Keys pre-filtered: <total> → <filtered> (saved ~X keys from visual pass)
Corrections applied: C
  - field X: old_key → new_key
  ...
Undetected static fields: L (keys present in key.json but not captured as widgets)
Output: <output path>
```

---

## Field Assignment Rules Reference

| Field type | Key suffix pattern |
|------------|-------------------|
| Checkbox   | `_Yes/No/Option/TypeName` |
| Textbox    | `_name/_npi/_phone/_dob/_date/_text/_specify` |
| Signature  | `signature_*`, `datesignature_*` |

Key naming:
- Format: `section_subsection_Label`
- ICD-10: `diagnosis_icd10codes__C50.411` (double underscore before code)
- Checkbox groups: same prefix, differ only in last segment
