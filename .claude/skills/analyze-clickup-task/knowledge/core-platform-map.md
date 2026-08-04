# Core platform — field-mapping sheet

Verified 2026-08-04 by reading the sheet directly. Re-verify with
`scripts/core-sheet.py` rather than trusting this file blind — tabs get added.

## The sheet

<https://docs.google.com/spreadsheets/d/1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374>

Link-readable without auth, so `core-sheet.py` pulls any tab as CSV. 38 tabs:
the Wellness chart family, then one tab per lab requisition form (PGx / CGX /
IMMUNO / NEURO / METABOLIC / DIABETES / UTI × Knuck, Hightech, PDL, Alpha Dera,
Amedix, Isacare), plus `tt <name>` tabs (test-tracking, not form definitions).

## Which tab holds which section — check this FIRST

The Wellness chart is split across **two** tabs per template. Reaching for the
`Wellness` tab when the task names an HRA section is the fastest way to conclude
"the field doesn't exist".

| Tab | gid | Sections |
|---|---|---|
| `Wellness` | 342956739 | Compliance · Advance Directive · Patient Information · Ordering Provider · Patient's Insurance Information · Primary Care Provider · Medical History · Family History · Review of Systems · Assessment & Plan · Verification · Diagnosis · RPM Vitals · RPM Diagnosis |
| `Wellness_HRA` | 410391867 | **General Health** · Preventive Screening and Immunization · Social History · **Functional Status & Safety** · Depression Screening · Advance Care Planning · Medications · Master Encounter Report · Opt-In Consent · Test Requirements |
| `Wellness Lite` | 1461217 | same section list as `Wellness` (317 rows each) |
| `Wellness Lite_HRA` | 314943004 | same section list as `Wellness_HRA` (188 rows each) |
| `Wellness Standard Patient Info` | 107745967 | Patient Information only (37 rows) |

Wellness and Wellness Lite are **parallel tabs with the same shape**. A task that
says "both Wellness and Wellness Lite" means the same edit lands in 2 or 4 tabs
(2 if the sections are all chart-side or all HRA-side, 4 if mixed).

## Columns that matter

`Section key` · `Section Name` · `Label` · `Placeholder` · `Optional Label` ·
`Description` · `Sale ` / `PSS` / `Provider` (role config — values seen: `EDIT`,
`HIDE`, `RES`) · `Case State to enable` · `Field's display priority` ·
`Field Type` · `field_key` · `Inline` · `Default Value` · `Values` ·
`HTML Content` · `Related Fields` · `CONDITIONAL VALUE` · `JSON` ·
`ROLE CONFIG` · `INCLUDE ONLY` · `EXCLUDE ONLY` · `CASE STATE PERMS`.

- `Values` is `;`-separated: `None;Cane;Walker;Wheelchair;Other`.
- `Field Type` counts in `Wellness_HRA` (188 rows): `radio` 74, `content` 41
  (heading/HTML block, not an input), `textfield` 24, `checkbox` 13, `textarea` 11,
  `select` 10, `selectboxes` 4, `datetime` 3, `number` 1, `separator` 1, blank 6.
- **`checkbox` vs `selectboxes`**: `checkbox` is a single boolean (e.g.
  `functional_safety_fall_risk_statement`, an attestation). A multi-select
  "check all that apply" group is **`selectboxes`** with `;`-separated `Values` —
  see `social_history_screening_drugs_yes`. A ticket asking for "multiple checkbox
  instead of radio" means `radio` → `selectboxes`/`selectboxshowother`, never
  `radio` → `checkbox`.

## Field Type vocabulary is NOT the same in chart tabs vs HRA tabs

| | Types in use |
|---|---|
| `Wellness`, `Wellness Lite` (22) | `checkbox` `checkboxhideothers` `checkboxshowothers` `content` `datetime` `datetime18plus` `email` `file` `icd10codes` `number` `phone_number` `phone_number_us` `radio` `radiosetvalue` `radioshowother` `select` `selectboxes` `selectboxshowother` `separator` `textarea` `textfield` `textfield_npi_number` |
| `Wellness_HRA`, `Wellness Lite_HRA` (10) | `checkbox` `content` `datetime` `number` `radio` `select` `selectboxes` `separator` `textarea` `textfield` |

## How conditional show/hide is declared (chart tabs)

**`Field Type` + the `Related Fields` column** — a suffixed type turns a control
into a trigger, and `Related Fields` (`;`-separated `field_key`s) is its payload:

| Type | Behaviour | Evidence |
|---|---|---|
| `radioshowother` | picking one option reveals `Related Fields` | `patient_suggested_for_rpm` (`Yes;No`) → `patient_suggested_consult_schedule`; `family_history_member_1_living_deceased` (`Living;Deceased`) → `..._related_health_issue` |
| `selectboxshowother` | multi-select whose `Other` option reveals `Related Fields` | `patient_ethnicity_selectboxes` (11 values ending `Other`) → `patient_ethnicity_other` |
| `checkboxshowothers` | checking it reveals `Related Fields` | `vital_blood_pressure` → 4 device fields |
| `checkboxhideothers` | checking it **hides** `Related Fields` | `patient_no_secondary_insurance` → all `patient_secondary_*`; `pcp_no_pcp_certification` → all `pcp_*` |
| `radiosetvalue` | sets a value on another field | 4 rows in `Wellness` |

This supersedes the earlier note that `CONDITIONAL VALUE` holds the logic — that
column is empty in all four Wellness-family tabs and appears unused.

**Caveat that matters:** the HRA tabs use **none** of these suffixed types. So
`functional_safety_screening_assistive_devices` (`radio`, values include `Other`)
sits next to `functional_safety_screening_assistive_devices_other` (`textfield`)
with no declared link at all. Unconfirmed whether the suffixed types are available
to the HRA renderer or only to the chart renderer — **ask before proposing them
for an HRA field.**

**No precedent for an exclusive "None"**: zero `selectbox*` rows in any
Wellness-family tab have `None` among their `Values`. `checkboxhideothers` is a
single checkbox hiding other *fields*, not an option that unchecks sibling
*options*. So "select None → uncheck everything else" has no existing pattern.
- `JSON` holds a Firebase URL to that component's Form.io schema, e.g.
  `https://dev-rce-dashboard.firebaseio.com/forms/<formId>/schema/components/<n>.json`
  — used for components too complex for the row format (grids, PHQ-9 blocks).

## field_key naming convention

`<section_prefix>_<subject>`, and a **dependent field appends its trigger**:

| Parent | Dependent |
|---|---|
| `functional_safety_screening_any_falls` (radio Yes;No) | `functional_safety_screening_any_falls_yes` (textfield "How many?") |
| `functional_safety_screening_assistive_devices` (radio) | `functional_safety_screening_assistive_devices_other` (textfield "Other:") |
| `social_history_screening_smoke` | `social_history_screening_smoke_yes` |

So a new free-text that appears when a Yes/No parent is `Yes` should be named
`<parent_key>_yes`. Section prefixes are not always the section name:
General Health uses both `general_health_*` and `health_behaviors_*`;
Functional Status & Safety uses `functional_safety_screening_*`.

## Known field keys — the ones tasks keep coming back to

Section `General Health` (`Wellness_HRA`, 27 rows):
- `general_health_hospitalized` — radio `Yes;No` — "Have you been hospitalized in the past 12 month?"
- `test_requirements_content_pain_sceening` — `content` — "PAIN SCREENING" heading (note the typo `sceening` in the key)
- `general_health_bodily_pain` — radio, 0–4 pain scale with prose labels
- `general_health_pain_score` — `number` — "Scale score"
- `health_behaviors_usually_exercise`, `health_behaviors_sleep_time` — radio

Section `Functional Status & Safety` (`Wellness_HRA`, 28 rows):
- `functional_safety_screening_content2` — `content` — "C. Fall Risk" heading
- `functional_safety_screening_any_falls` — radio `Yes;No`
- `functional_safety_screening_any_falls_yes` — textfield "How many?"
- `functional_safety_screening_afraid_falling` — radio `Yes;No`
- `functional_safety_screening_assistive_devices` — **radio** `None;Cane;Walker;Wheelchair;Other`
- `functional_safety_screening_assistive_devices_other` — textfield "Other:"
- `functional_safety_fall_risk_statement` — checkbox attestation, Provider `RES`
- `functional_safety_screening_adls`, `functional_safety_screening_IADL` — radio, schema in `JSON`

## Open questions — ask the user, do not guess

1. **Are the suffixed trigger types available in the HRA tabs?** They are used
   only in `Wellness` / `Wellness Lite`. Every conditional field this kind of
   ticket asks for lands in `_HRA`, so this gates the whole approach.
2. **How should an exclusive option ("None" unchecks the rest) be built?** No
   precedent anywhere in the sheet.
3. **Does editing the sheet drive the platform, or does it document it?** i.e.
   is the deliverable a sheet edit, a Form.io schema edit, or both.

## Progress Note → Master Encounter Report

"Update the document template / Progress Note" maps to the
`Master Encounter Report` section (21 rows, present in both `Wellness_HRA` and
`Wellness Lite_HRA` with identical keys):

`mer_progress_notes_soap_panel_text` (panel title) → `mer_progress_notes_subjective`
· `mer_progress_note_objective` (note the singular `note` — inconsistent with its
siblings) · `mer_progress_notes_assessment` (`content`) · `mer_progress_notes_plan`
· `mer_progress_notes_discussion_notes` — all `textarea`.

Then `mer_clinical_encounter_notes_*`, `mer_letter_of_medical_necessity_*`,
`mer_attestation_consent_*`.

Still unconfirmed: whether a new HRA input surfaces in the note automatically or
whether one of these textareas has to be edited by hand — ask before promising
either.
