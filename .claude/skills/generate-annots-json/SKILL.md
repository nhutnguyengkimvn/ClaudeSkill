---
name: generate-annots-json
description: >
  Generates the AnnotsJSON for a lab PDF form by running the CommonForms
  pipeline: ML field detection → key assignment → Claude visual verification.
  Outputs a JSON array of annotated form fields (AnnotsJSON format) ready to
  be pasted into the medicalpdf admin page.
  Called from import-lab-recform W05 when AnnotsJSON is null, or standalone.
---

# Generate AnnotsJSON

Converts a flat lab PDF into an annotated field JSON (AnnotsJSON) using the
[CommonForms](https://github.com/jbarrow/commonforms) toolkit + Claude visual
verification. The output is the `AnnotsJSON` field value for
`<DASHBOARD_URL>/admin/ehealth/medicalpdf/`.

## Full pipeline

```
PDF  →  detect_to_json.py  →  detected.json
detected.json + key.json + PDF  →  assign_keys.py  →  assigned.json
assigned.json + key.json + PDF  →  form-key-verifier (Claude)  →  assigned_fixed.json
assigned_fixed.json  →  paste into medicalpdf AnnotsJSON field  →  Save
→  import-key-to-pdf  →  add ICD-10 panel prefixes
```

## Invocation

```
generate-annots-json <path.pdf> [--key <key.json>] [--dashboard <url>] [--medicalpdf-id <id>]
```

- `<path.pdf>` — original source PDF (with text layer, NOT the flattened copy).
- `--key <key.json>` — field key list for this form. If omitted, Claude generates
  one automatically (Step 1b).
- `--dashboard <url>` — dashboard base URL. If omitted and not inherited, ask user.
- `--medicalpdf-id <id>` — UUID of the medicalpdf record. If omitted, the skill
  searches by filename after the pipeline finishes.

When called from **import-lab-recform W05**, `<PDF_PATH>`, `<DASHBOARD_URL>`,
and `<MEDICALPDF_ID>` are already set — skip Phase 0 and go straight to Step 1.

## Output Language

All user-facing output is in **English**, regardless of conversation language.

---

## Phase 0 — Validate Inputs (standalone only)

1. Check `<path.pdf>` supplied; if missing → `❌ No PDF path.` STOP.
2. Validate path exists and ends with `.pdf`.
3. Ask for `--dashboard` if not supplied.
4. Confirm Playwright MCP logged in to `<DASHBOARD_URL>/admin/` (if uploading result).

---

## Step 1a — Load or generate key.json

**Pre-built key lists** (check these first before generating from scratch):

| Form type | File |
|-----------|------|
| CGX / Hereditary Cancer Panel | `.claude/skills/generate-annots-json/keys/cgx-hereditary-cancer.json` |

If the current PDF matches a pre-built key list → load it directly, report
`✅ key.json loaded from pre-built list: N keys`, then go to **Step 1c**.

If `--key` was supplied:
- Load the file. Report: `✅ key.json loaded: N keys`.
- Go to **Step 1c**.

If neither → go to Step 1b (generate from PDF).

## Step 1b — Generate key.json from PDF

> Goal: produce an ordered list of key strings matching the naming conventions
> below, covering every **annotatable** form field in the PDF.
>
> **FIRST:** Go to **Step 1c** immediately — if the Form.io JSON is available
> it provides the authoritative clinical/panel/gene keys. After Step 1c,
> supplement with the standard conventions below for patient/insurance/ordering
> sections that Form.io does not cover.

## Step 1c — Supplement from Form.io JSON (always run after 1a or 1b)

> The Form.io schema saved in W04 contains the authoritative component keys for
> all clinical, panel, gene, and ICD-10 fields of this specific form. Always
> merge these into the key list — even when a pre-built key list was used.

1. Look for the Form.io JSON file in the project folder:
   ```
   <project-dir>/<recform-slug>/<recform-slug>-formio.json
   ```
2. If **not found** → skip silently, continue with the existing key list.
3. If **found**:
   a. Parse the JSON. Walk every component recursively (including nested
      `components` arrays inside panels, columns, fieldsets, etc.).
   b. Collect every `key` string that is **not** in the existing key list.
   c. Append the new keys to the key list (preserve original order first,
      then append Form.io additions).
   d. Report:
      ```
      ✅ Form.io JSON found: +K new keys merged (total: N keys)
         Source: <recform-slug>-formio.json
      ```
4. If the Form.io JSON is malformed → warn and continue with the existing list.

> **Why:** the pre-built key lists cover common patterns, but each lab's variant
> may have extra clinical fields, unique gene checkboxes, or custom ICD-10 codes
> that only appear in their specific Form.io schema. Step 1c ensures those are
> never missed without requiring a full key-list regeneration.

---

### Naming conventions

**Ordering Physician section**

| Label | Key |
|-------|-----|
| Physician Name | `order_full_name` |
| NPI# | `order_npi` |
| FAX# | `order_fax` |
| Office/Practice/Institution Name | `order_provider_network` |
| Physician's Email | `order_email` |
| Street Address | `network_address` |
| City | `network_city` |
| State | `network_state` |
| Zip Code | `network_zip_code` |
| Office Contact Name | `order_provider_network` |
| Contact Phone | `order_provider_network_phone` |

**Patient Information section**

| Label | Key |
|-------|-----|
| Patient First Name | `patient_first_name` |
| Patient Last Name | `patient_last_name` |
| Date of Birth | `patient_dob` |
| Phone Number | `patient_phone` |
| Street Address | `patient_address` |
| City | `patient_city` |
| State | `patient_st` |
| Zip Code | `patient_zip_code` |
| Email Address | `patient_email` |

**Gender Identity** — include **only** Male and Female checkboxes:

| Option | Key |
|--------|-----|
| Male | `patient_gender_Male` |
| Female | `patient_gender_Female` |

> Skip: Female-to-Male, Male-to-Female, Genderqueer, Other, Choose not to
> Disclose, Sexual Orientation section → **no keys for these**.

**Ancestry** — use `patient_ethnicity_selectboxes_` prefix:

| Option | Key |
|--------|-----|
| White/Caucasian | `patient_ethnicity_selectboxes_white` |
| Native American | `patient_ethnicity_selectboxes_native_american` |
| Hispanic | `patient_ethnicity_selectboxes_hispanic` |
| African American | `patient_ethnicity_selectboxes_african_american` |
| Ashkenazi Jewish | `patient_ethnicity_selectboxes_ashkenazi_jewish` |
| Middle Eastern | `patient_ethnicity_selectboxes_middle_eastern` |
| American Indian | `patient_ethnicity_selectboxes_american_indian` |
| Asian | `patient_ethnicity_selectboxes_asian` |
| Native Hawaiian / Pacific Islander | `patient_ethnicity_selectboxes_native_hawaiian` |

**Payment Options section**

| Option | Key |
|--------|-----|
| Insurance Billing checkbox | `patient_primary_type_Medicare` |
| Self-Pay checkbox | *(skip — no key)* |
| Client Billing checkbox | *(skip — no key)* |
| Primary Insurance name | `patient_primary_name` |
| Primary Insurance Policy/ID# | `patient_primary_insurance_id` |
| Primary Group# | `patient_primary_group` |
| Primary Policy Holder Name | `patient_full_name` |
| Primary Holder DOB | `patient_dob` |
| Secondary Insurance name | `patient_secondary_name` |
| Secondary Insurance Policy/ID# | `patient_secondary_insurance_id` |
| Secondary Group# | `patient_secondary_group` |
| Secondary Policy Holder Name | `patient_full_name` |
| Secondary Holder DOB | `patient_dob` |

**Specimen Information section** → **SKIP ENTIRELY** (no keys).

**ICD-10 code checkboxes**

| Pattern | Example |
|---------|---------|
| `diagnosis_icd10codes__<CODE>` | `diagnosis_icd10codes__J96.0` |

> The free-text **"Additional / Other ICD-10 Codes"** field at the bottom of the
> ICD-10 section uses key: **`diagnosis_additional_icd10_codes`**
> (not a checkbox — it is a text input).

**Signatures**

| Pattern | Example |
|---------|---------|
| `signature_<id>` | `signature_patient`, `signature_physician` |
| `datesignature_<id>` | `datesignature_patient`, `datesignature_physician` |

> When `<id>` is a **numeric timestamp** (e.g. `signature_1781252108317`,
> `datesignature_1720606221698`), this is a **provider/physician signature** field —
> the number is a form-generated component ID, not a date. Map the provider
> signature line to `signature_<timestamp>` and its date to `datesignature_<timestamp>`.
> Patient signatures use `patient_signature_<timestamp>` / `patient_datesignature_<timestamp>`.

**Clinical History / Panel / Gene fields**

> Use the exact keys from the Form.io schema (W04 output). The Form.io
> component keys already follow the correct structure — copy them directly.
> Do NOT invent new key names for clinical fields.

---

### Steps

1. Read the full PDF with the `Read` tool (all pages).
2. Map each PDF field to a key using the tables above. Preserve reading order
   (top→bottom, left→right, page order).
3. For clinical / panel / gene / ICD-10 fields: leave them as placeholders for
   now — Step 1c will fill the authoritative keys from the Form.io JSON.
4. Omit: Sexual Orientation, specimen fields, Self-Pay/Client Billing checkboxes.
5. Deduplicate. Save draft to `/tmp/key-<recform-slug>.json`.
6. **Run Step 1c** to merge Form.io keys.
7. Show the final key list and ask: **"Does this look correct? (yes / edit)"**
   - Wait for confirmation before proceeding to Step 2.

---

## Step 2 — Detect form fields (ML)

```bash
SKILL=".claude/skills/generate-annots-json"
VENV=".claude/skills/generate-annots-json/.venv"   # skill has its own venv with torch/commonforms

"$VENV/bin/python3" "$SKILL/scripts/detect_to_json.py" \
  "<PDF_PATH>" \
  "/tmp/detected-<recform-slug>.json"
```

Report: `✅ Detected N fields → /tmp/detected-<recform-slug>.json`

If the script fails with an import error → instruct user to run:
```bash
.claude/skills/generate-annots-json/install.sh
```
Then retry.

---

## Step 3 — Assign keys

```bash
VENV=".claude/skills/generate-annots-json/.venv"   # same dedicated venv

"$VENV/bin/python3" "$SKILL/scripts/assign_keys.py" \
  "/tmp/detected-<recform-slug>.json" \
  "<KEY_JSON_PATH>" \
  "<PDF_PATH>" \
  "/tmp/assigned-<recform-slug>.json"
```

Report: `✅ Assigned M/N fields → /tmp/assigned-<recform-slug>.json`

Show unmatched fields (score below threshold) to the user; they are kept with
their placeholder `contents` value and will be corrected in Step 4.

---

## Step 4 — Visual verification with form-key-verifier

Invoke the `form-key-verifier` skill inline:

```
/form-key-verifier \
  --keys <KEY_JSON_PATH> \
  --pdf <PDF_PATH> \
  --assigned /tmp/assigned-<recform-slug>.json \
  --output /tmp/annots-<recform-slug>.json
```

This reads each PDF page visually and corrects wrong/missing key assignments.

Report after completion:
```
✅ form-key-verifier: C corrections applied
   Output: /tmp/annots-<recform-slug>.json
```

---

## Step 5 — Save output file + report

Load `/tmp/annots-<recform-slug>.json` and copy it to the project folder:

```bash
cp /tmp/annots-<recform-slug>.json "<project-dir>/<recform-slug>/annots-<recform-slug>.json"
```

Print summary:
```
Total fields detected:  N
Assigned fields:        M
Unassigned (placeholders): K
ICD-10 code fields:     X

✅ AnnotsJSON saved: <project-dir>/<recform-slug>/annots-<recform-slug>.json

Next step: Open the file, copy all content, paste into the AnnotsJSON Ace
editor at:
  <DASHBOARD_URL>/admin/ehealth/medicalpdf/<MEDICALPDF_ID>/change/
Then click Save.
```

**STOP** — the skill is done. The user handles the paste + save manually.

---

## Step 6 — (After user saves) Continue to import-key-to-pdf

Once the user confirms the AnnotsJSON is saved in the dashboard, invoke
`import-key-to-pdf` (W05 Step 3 onwards) to add ICD-10 panel prefixes to
the `diagnosis_icd10codes__<ICD>` entries.

---

## Final Report (standalone)

```
PDF:               Primary Immunodeficiency.pdf
Key list:          /tmp/key-immuno-alphaders-2026.json  (N keys)
Detected fields:   N
Assigned fields:   M  (K unassigned)
Corrections:       C  (by form-key-verifier)
ICD-10 fields:     X
AnnotsJSON file:   <project-dir>/<recform-slug>/annots-<recform-slug>.json
```
