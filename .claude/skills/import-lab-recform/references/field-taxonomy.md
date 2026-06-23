# Field Taxonomy, Business Rules & ICD-10 Routing (Workflow 04)

Used by Workflow 04 to decide **which** reqform fields become Form.io order-entry
fields, **before** any JSON is built. A reqform asks for ~40 things, but the EMR
already *knows* most of them. Render only the per-order clinical decisions the
provider must supply.

## 1. Classify every detected field into one of three buckets

- **EMR-prepopulated** — already in the patient record, clinic profile, or
  payer-on-file. **Do NOT render.**
  Default to this bucket: patient demographics, ordering physician/clinic,
  payment options, specimen/sample, consent/signature.
- **Provider input** — a per-order clinical decision not stored anywhere.
  **Render as a Form.io field.**
  Default to this bucket: test-panel selection, panel/gene composition, test
  parameters, clinical assessment (personal + family cancer history), ICD-10
  diagnosis selection, testing criterion (e.g. NCCN), test-specific modules
  (e.g. PGx medications datagrid).
- **Fixed** — the three components present on every reqform regardless of lab
  (see §3). **Always render.**

For each field, note its bucket. List what you **excluded** (and why) so the
confirmation step is transparent.

## 2. Business rules (apply before confirming)

The target deployment has fixed constraints — apply them and note every field
you drop and why:

- **Medicare-only billing** → generate **NO** payment-capture fields (self-pay,
  commercial, client/institutional billing all dropped). Because Medicare
  requires documented medical necessity (42 CFR §410.32), mark the
  medical-necessity inputs **required**: the testing-criterion (NCCN) field and
  at least one ICD-10 / Relevant Diagnosis.
- **Adults / elderly only** → **never silently drop a whole Test Panel.** Any
  age-restricted / pediatric-only panel (e.g. one the PDF marks "NOT FOR ELDERLY
  PATIENTS") must be surfaced at the Workflow-04 step-4 confirmation as
  **"proposed to drop — AWAITING APPROVAL"** and dropped **only if the user
  approves**; otherwise render it. Default is to render **every** Test Panel the
  PDF offers. Pediatric-only *indications or options within a rendered panel* may
  still be dropped, but **flag** each one.

## 3. The three FIXED fields (always included, every reqform)

Constant across all labs; include even if the reqform doesn't show them:

1. **Additional Clinical Context** — `textfield`,
   `key: order_service_additional_clinical_context`.
2. **Relevant Diagnosis** — `select` `multiple: true`,
   `key: order_service_patient_s_personal_cancer_diagnosis` style key,
   **system-fed**: `dataSrc: custom` pulling the diagnoses the system already
   holds on the case (e.g.
   `window.currentCase?.case_data?.rawjson?.diagnosis_icd10codes`). Do **NOT**
   copy the reqform's ICD-10 list into this field's options — those codes feed
   the routing map (§4), not the form.
3. **Instructions** — `textarea`, `key: order_service_instructions`.

## 4. ICD-10 → reqform ROUTING MAP (not a form field)

The reqform's ICD-10 list is used for **routing**, not for populating the form.

- **Per-panel map (preferred)** when the reqform prints a code block under each
  panel: carry each panel's codes with its panel option. An order routes to a
  panel when BOTH hold — the selected Test Panel **is** that panel AND the
  selected Relevant Diagnosis code is in **that panel's** list. Lets two
  methodology panels in one disease area carry different code sets.
- **Flat map (fallback)** when there are no per-panel code blocks: an order
  routes to this reqform when the selected code is in the reqform's list and the
  selected panel is one it offers.

Extract codes **verbatim**; invent no categorization beyond a
primary/secondary/cross-panel tag the reqform itself prints. Capture the routing
map alongside the form (e.g. a note / `*_routing_map.json` in the recform
folder) — it is metadata, not a rendered component.

**Methodology splits:** when a disease area offers an NGS panel **and** a
separately-coded "separate methodology" block (PCR / MLPA / repeat-expansion),
make each a distinct panel named `"<DISEASE AREA> | <METHODOLOGY>"` rather than a
generic standalone-assays field.

## Notes

- Keep the reqform's original wording for option labels — clinicians recognize
  them. Don't "improve" them.
- Conditional "specify…" fields (laterality, other malignancy, other NCCN
  criterion) show only when their trigger option is selected
  (`customConditional`).
- This produces an order-entry form, not medical advice. It never decides which
  panel or ICD-10 a patient should get — the provider does. Medical-necessity /
  coding responsibility stays with the ordering physician per 42 CFR §410.32.

## Clinical Symptom Sections — radio, not selectboxes

**Applies to:** General, Head & Neck, Skin, Hematologic History, Oncologic
History, Infectious Disease History, Laboratory Findings.

- Use `radio` (single-select), NOT `selectboxes`. Clinicians select the **one**
  primary presenting symptom per category.
- For any option whose label contains "Other" (e.g. "Other; specify"):
  - Set `value: "Other"` (not the full label string).
  - Add a conditional `textfield` immediately after the radio, shown when the
    radio value === `"Other"`.
  - Key convention: `test_requirements_<section>_other_specify`

Example shape:
```json
{
  "type": "radio",
  "key": "test_requirements_general_symptoms",
  "label": "General",
  "values": [
    {"label": "Acute liver failure", "value": "Acute liver failure"},
    {"label": "Other; specify", "value": "Other"}
  ]
},
{
  "type": "textfield",
  "key": "test_requirements_general_symptoms_other_specify",
  "label": "Specify",
  "conditional": {"show": true, "when": "test_requirements_general_symptoms", "eq": "Other"}
}
```
