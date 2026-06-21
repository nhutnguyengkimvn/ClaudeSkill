# Field Type Rules — Foxit PDF Builder

> Defines how to handle every category of field encountered in the PDF builder.
> Read this before Step 5 of Workflow 03.

---

## 1. Pre-existing EMR fields — SKIP (already in PDF, no action)

These keys are placed by the system from the EMR. They are **already present**
in the PDF builder. Do NOT add duplicates. Just verify they're there if needed.

**Patient info:**
```
patient_first_name        patient_last_name       patient_mi
patient_dob               patient_phone           patient_email
patient_address           patient_city            patient_state
patient_zip_code          patient_gender_Female   patient_ethnicity_selectbox
patient_primary_type_     patient_primary_name    patient_secondary_name
patient_primary_insurance_id                      patient_full_name
```

**Provider / ordering physician info:**
```
order_full_name           order_npi               order_fax
order_email               order_provider_network  order_provider_network_phone
network_address           network_city            network_state
network_zip_code
```

**Specimen / billing:**
```
date_of_service           patient_primary_type_   self (static value)
```

---

## 2. Patient signature fields — RIGHT-CLICK → DELETE

Foxit auto-generates signature placeholder fields with long numeric IDs when a
PDF is first imported. These belong to the **Patient Consent / Patient Sign
Here** sections and are **not keyed** — they must be removed.

**Patterns to delete (right-click → Delete in the field list):**
```
signature_<digits>              e.g. signature_1781252108317
datesignature_<digits>          e.g. datesignature_1781252108317
patient_signature_<digits>      e.g. patient_signature_1662733353269
patient_datesignature_<digits>  e.g. patient_datesignature_1662733353269
```

**How to identify:** key matches `^(patient_)?d?atesignature_\d+$` OR
`^signature_\d+$`. Any signature-like field with ONLY digits as suffix →
delete it.

> These appear in sections labelled "PATIENT CONSENT", "PATIENT SIGN HERE",
> "PATIENT ACKNOWLEDGEMENT". Do NOT delete physician signature fields.

---

## 3. Physician / Doctor signature — ADD SIGNATURE BUTTON

Sections: **"CERTIFICATE OF MEDICAL NECESSITY... PHYSICIAN SIGNATURE"**,
**"ORDERING PHYSICIAN SIGN HERE"**, **"PHYSICIAN SIGNATURE"**.

**How to handle:**
1. Click the **"Add Signature"** button in the builder toolbar.
2. Foxit auto-creates **2 yellow boxes**: one for the signature, one for the date.
3. **Drag** each yellow box to the correct position in the physician signature
   section — signature box to the Signature line, date box to the Date line.
4. No specific key name to set — Foxit auto-assigns internal refs (e.g. `1_80`,
   `1_81`). These are fine as-is.

> Do this ONCE per physician signature section. Most forms have 1 section
> (ordering physician). Some have 2 (ordering + overread physician).

---

## 4. ICD-10 code fields — GENERATED FROM FORM.IO

ICD code keys are generated based on whether the Form.io form splits ICD codes
**per panel** or uses a **single global** diagnosis component.

### 4a. Detection — how to tell which mode

Look at the Form.io schema (from Workflow 01):

**Per-panel mode** — the form has separate `selectboxes` diagnosis components,
one per panel, each with a `customConditional` that shows it only for that panel.
The component key will include panel references. Panel values come from the
`order_service_test_panel` selectboxes values.

**Global mode** — the form has ONE shared diagnosis/ICD component (or the ICD
checkboxes are in a single section not tied to any panel conditional).

### 4b. Key format

**Per-panel:**
```
diagnosis_icd10codes_panel_<panel_value>__<icd_code>
```
- `<panel_value>` = exact `value` string of the panel from Form.io
  (e.g. `Hereditary Neuromuscular Disorders - NGS Panel`)
- `<icd_code>` = ICD-10 code (e.g. `Q60.0`, `B20`, `F32.1`)
- Double underscore `__` separates panel value from code

Example:
```
diagnosis_icd10codes_panel_Hereditary Neuromuscular Disorders - NGS Panel__Q60.0
diagnosis_icd10codes_panel_METACORE-Dx | PCR/MLPA / Repeat Expansion — Adult/Elderly Patients__E75.25
```

**Global (single ICD list):**
```
diagnosis_icd10codes__<icd_code>
```
Example:
```
diagnosis_icd10codes__B20
diagnosis_icd10codes__F32.1
diagnosis_icd10codes__E78.010
```

### 4c. Confirm gate — ask user before generating ICD keys

Before generating ICD keys, show the user:
```
ICD mode detected: [Per-panel / Global]

  Per-panel: keys will be  diagnosis_icd10codes_panel_<panel_value>__<code>
  Global:    keys will be  diagnosis_icd10codes__<code>

  Panels found (for per-panel mode):
    - <panel_value_1>
    - <panel_value_2>
    ...

  ICD codes found in Form.io: N codes

Proceed with [per-panel / global] mode? (yes / switch to other / stop)
```

### 4d. Source of ICD codes

ICD codes come from the Form.io `selectboxes` diagnosis component values.
Each value object has a `value` (the code) and `label` (the description).
Collect ALL code values from the diagnosis selectboxes — these become the `<icd_code>` part.

ICD codes can appear in:
- `diagnoses` component
- `order_service_diagnosis_icd10` or similar key
- Nested inside panel components with `customConditional`

---

## 5. Non-prefix specialty keys — FLAG FOR CONFIRMATION

Some Form.io keys don't follow the `order_service_*` pattern and have no
established PDF-builder equivalent. Examples seen:
```
generationsAffected
specifyIndicationForTesting
```

For these → flag with `action: "confirm"` and ask user before adding:
```
Found unusual key (no order_service_ prefix): "generationsAffected"
→ Proposed PDF-builder key: "generationsAffected" (unchanged)
Add as-is, rename, or skip?
```

---

## Summary decision table

| Field category | Action |
|---|---|
| EMR patient/provider info keys | SKIP — already in PDF |
| `signature_<digits>` / `datesignature_<digits>` (patient section) | RIGHT-CLICK → DELETE |
| Physician signature section | ADD SIGNATURE button → drag 2 yellow boxes |
| ICD code fields | GENERATE keys (per-panel or global) → add each |
| `order_service_*` Form.io keys | MAP via key-mapping-rules.md → add |
| Structural/button/layout Form.io keys | SKIP — not applicable to PDF |
| Unknown prefix keys | FLAG → confirm with user |
