# Workflow 03 — Fill Keys in Foxit PDF Builder

> Opens the Foxit PDF Builder admin, finds the reqform PDF, then handles
> each field category: deletes patient signature stubs, adds physician
> signature via button, generates + adds ICD keys, and adds mapped
> `test_requirements_*` keys. Read `references/field-type-rules.md` first.

## Step 1 — Navigate to Foxit PDF Builder admin

```
<DASHBOARD_URL>/admin/form-builder/
```

Take a `browser_snapshot` to confirm the page loaded.

## Step 2 — Find the reqform PDF

1. Search for the reqform (e.g. `METABOLIC - Amedix 2026` or `Metabolic Amedix`).
2. `browser_snapshot` → click the matching entry.
3. If multiple matches → show list to user, ask which one.
4. If none → try Short Code only, then Lab name only. Still none → `❌ Not found` and STOP.

## Step 3 — Read existing fields from the left panel

1. `browser_snapshot` to capture the full field list in the left sidebar.
2. Scroll through if paginated — collect every key name shown.
3. Store as `existing_keys = [...]`.

Supplement with DOM evaluation if list is truncated:
```javascript
Array.from(document.querySelectorAll('[data-field-name], .field-list-item, .pdf-field-key'))
  .map(el => el.getAttribute('data-field-name') || el.textContent.trim())
  .filter(Boolean)
```

---

## Step 4 — Handle PATIENT SIGNATURE fields (right-click → Delete)

Read `references/field-type-rules.md` § 2 for the pattern.

From `existing_keys`, find all fields matching:
- `signature_<digits>` — e.g. `signature_1781252108317`
- `datesignature_<digits>` — e.g. `datesignature_1781252108317`
- `patient_signature_<digits>`
- `patient_datesignature_<digits>`

For each found:
1. Right-click the field entry in the left panel.
2. Select "Delete" from the context menu.
3. Confirm deletion if a dialog appears.
4. Log: `🗑️ Deleted patient signature stub: <key>`

> These are in "PATIENT CONSENT" / "PATIENT SIGN HERE" sections.
> After deletion they will NOT appear in any patient-side data — correct.

---

## Step 5 — Handle PHYSICIAN SIGNATURE (Add Signature button)

Read `references/field-type-rules.md` § 3.

Look for physician signature sections in the PDF preview:
- "CERTIFICATE OF MEDICAL NECESSITY, CONSENT, TEST AUTHORIZATION AND PHYSICIAN SIGNATURE"
- "ORDERING PHYSICIAN SIGN HERE"
- "PHYSICIAN SIGNATURE"

If ANY physician signature section is found AND it does NOT already have a
proper signature field (no `1_80`/`1_81` style fields or similar):

1. Click the **"Add Signature"** button in the builder toolbar.
2. Foxit creates 2 yellow boxes (signature + date).
3. **Drag** each box to its line in the physician signature section:
   - Signature yellow box → "Signature" line
   - Date yellow box → "Date" line
4. Log: `✅ Added physician signature (2 yellow boxes dragged into position)`

If the section already has physician signature fields → skip and log:
`⏭️ Physician signature already present — skipped`

> There may be 2 physician sections (ordering + overread). Repeat for each.

---

## Step 6 — Generate ICD code keys

Read `references/field-type-rules.md` § 4.

Use `icd_mode`, `panel_values`, `icd_codes` from Workflow 01 Step 5.

### 6a. Confirm ICD mode with user

Show the confirm gate (from `references/field-type-rules.md` § 4c):
```
ICD mode detected: [per-panel / global]

  Per-panel: keys → diagnosis_icd10codes_panel_<panel_value>__<code>
  Global:    keys → diagnosis_icd10codes__<code>

  Panels (for per-panel): <list>
  ICD codes found: N

Proceed with [mode]? (yes / switch / stop)
```

Wait for user confirmation. Apply mode switch if requested.

### 6b. Generate the full ICD key list

**Per-panel:** For EACH panel value × EACH ICD code:
```
diagnosis_icd10codes_panel_<panel_value>__<code>
```

**Global:** For EACH ICD code:
```
diagnosis_icd10codes__<code>
```

Diff against `existing_keys` — only add those missing.

### 6c. Add ICD keys

For each missing ICD key:
1. In the left panel, use "Add Field" / "Add Text Field" (or appropriate add action).
2. Set the key name exactly as generated above.
3. Place the field at the correct ICD code checkbox/line in the PDF.
4. `browser_snapshot` to verify key appears in the list.

> ICD key count can be large (10–100+). If the builder supports batch add or
> copy-paste of key names, use it. Otherwise add one by one.
> Log every 10 added: `ICD keys: X/N added…`

---

## Step 7 — Add mapped test_requirements_* keys

Use `target_keys` confirmed in Workflow 02.

Diff against `existing_keys` (updated after Steps 4–6):
```
KEYS TO ADD:   test_requirements_test_order_panel, …
KEYS TO SKIP:  test_requirements_test_order_medical_review (already present), …
```

Show diff to user:
```
Ready to add N test_requirements_* keys. Proceed? (yes / stop)
```

For each missing key:
1. Add field in the left panel.
2. Set key name exactly.
3. Drag/place the field at the correct area in the PDF.
4. Verify in list via `browser_snapshot`.
5. On failure → log `❌ <key> — add failed` and continue.

---

## Step 8 — Save

1. Click **Save** in the builder.
2. Wait for success message.
3. Take a final `browser_screenshot` showing the updated field list.

---

## Step 9 — Final summary

Print:
```
PDF:       <source PDF name>
Form.io:   <FORM_DISPLAY_TITLE>
ReqForm:   <RECFORM_NAME>

Patient signature stubs deleted: N  (🗑️)
Physician signature added: yes/no   (✅/⏭️)
ICD keys added: N  (<mode> mode)
test_requirements_* keys added: N
Keys skipped (already present): N
Keys failed: N
```
