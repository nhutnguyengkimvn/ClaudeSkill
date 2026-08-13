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

  **These are shared component libraries, not per-template forms.** Verified
  2026-08-11: `Wellness_HRA` and `Wellness Lite_HRA` both point at the same four
  form ids (`-Oh4h22S2yE5Fakz-mWJ` for HRA questionnaires, `-OpfJQ0WR7u-NxU_I3lv`
  for MER, plus `-OsQZ460f1v1FdlX-1r4` and `-Oj4VAW6XjwWNICjyldM`), and the two
  tabs pull *different* component indexes out of the same form — Wellness_HRA
  uses components 0–4 of `-Oh4h22S2yE5Fakz-mWJ`, Wellness Lite_HRA only
  component 4. So moving a `JSON`-backed field between templates needs **no**
  Form.io copy: carrying the URL on the row is the whole job. Do not plan a
  "copy the component into the target form" step — check the form ids first.

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

## How the HRA tabs do conditionals, per-option values and scoring

**Resolved 2026-08-11.** The HRA tabs don't use the suffixed trigger types at
all — they carry raw Form.io config in two columns that the summary view hides.

**Which column takes which property** (got this wrong on 2026-08-12 — see
`learned-rules.md`; the boundary is strict):

| Column | Header | Holds |
|---|---|---|
| **AD** (30) | `additional_component_props JSON` | `conditional {show,when,eq}`, per-option `values`, `customClass` |
| **AE** (31) | `customFormIOfield` | `append_logic`, `clearOnHide`, `customConditional`, `calculateValue`, `recalculateOn`, `validate`, `defaultValue`, `tooltip` |

AE is frequently already populated (`customClass: formio-column-50`,
`validate {min,max}`) — merge into it, never overwrite.

**`additional_component_props JSON`** — merged into the component definition.
Two uses seen:

- *Per-option values*, when the label a provider sees differs from the value
  stored. This is how a scored questionnaire declares its weights:
  ```json
  {"values": [{"label": "Not at all", "value": "0", "shortcut": ""},
              {"label": "Several days", "value": "1", "shortcut": ""}]}
  ```
  (`test_requirements_depression_screening_things_phq2`). The `Values` column
  still holds the `;`-separated labels; this column overrides the values.
  **So scoring weights ARE expressible in the sheet** — earlier note saying they
  are not was wrong.
- *Conditional show/hide*, the HRA equivalent of `Related Fields`:
  ```json
  {"conditional": {"show": true, "when": "social_history_screening_alcohol", "eq": "Yes"}}
  ```
  (`social_history_screening_alcohol_score`).

**`customFormIOfield`** — the heavier hooks:

- `calculateValue` — a JS string that computes a field from others. This is how
  every screening total is built; both `social_history_screening_alcohol_score`
  (CAGE) and `test_requirements_depression_screening_score` (PHQ) sum
  `Number(data.<key>)` across their question keys.
- `append_logic` — named action blocks with a `javascript` trigger, used to
  hide/clear a field on case age (`moment(window.currentCase.created_at)`) or on
  provider group (`window.currentCase?.provider?.group?.id`) plus
  `window.role == 'doctor'`. `test_requirements_content_PERSONAL_PLAN` carries
  such a gate — a copied row brings its gate with it.
- `defaultValue`, `clearOnHide`.

**The scored-questionnaire pattern**, reusable verbatim: N `radio` rows carrying
weights in `additional_component_props JSON` → one `textfield` `..._score`
(Provider `VIEW`) whose `customFormIOfield.calculateValue` sums them → one
`content` `..._score_table` holding an interpretation table as an HTML
`<table class="table table-bordered">` → optional `content` rows for the
positive/negative summary sentences.

## Section placement is the `Display priority` column

Every row of a section shares one integer. `Wellness Lite_HRA`:
`opt_in_consent`=2 · `medication`=6 · `test_requirements`=8 · `general_health`=10
· `screening_questionnaire_depression`=11 · `social_history_screening`=12 ·
`advance_care_planning`=16 · `mer`=22. `Wellness_HRA` adds `preventive_care`=13
and `functional_safety_screening`=15.

Note the trap: Depression Screening (11) renders **before** Social History (12),
which is not the order `--sections` prints. Inserting between two adjacent
integers means renumbering the sections below.

Within a section, order is `Field's display priority`, 1..N — duplicates exist
and are tolerated.

## Open questions — ask the user, do not guess

1. ~~Are the suffixed trigger types available in the HRA tabs?~~ **Resolved:**
   no — the HRA tabs declare conditionals in `additional_component_props JSON`
   instead. See the section above.
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

## `__json__` rows — how to RECOGNISE a row that uses the `JSON` column

Added 2026-08-12 (user pointed it out) on top of the `JSON` note above — that note knew
column V holds a URL but missed three things that matter:

1. **The marker lives in column A** (`__skip__`, index **0**): the row has
   **`A == '__json__'`**. The header row itself reads `__skip__`. Without that marker it is
   not a JSON-backed row.
2. **`Field Type` (N) and `field_key` (O) are usually EMPTY on a `__json__` row** — type,
   key and label come from the fetched JSON. **This is not a data gap**; do not report
   "missing Field Type" for these rows (reported it wrongly once — see `learned-rules.md`,
   2026-08-12).
3. **AD and AE still apply and are merged ON TOP of the fetched component** — order is
   fetched JSON → AD → AE, with `append_logic` appended to any `logic` the JSON already has.
   Example: `mer_progress_notes_subjective` carries
   `AD = {"attributes": {"panel-key": "mer_progress_notes"}}`.

The Firebase endpoint returns `access-control-allow-origin: *`, so a browser can read it with
plain `fetch()` (unlike Google's gviz, which needs JSONP).

Example payload: `.../-Oh4h22S2yE5Fakz-mWJ/schema/components/1.json` →
`type: datagrid`, `key: preventive_past_immunization`, three children (`vaccine` textfield,
`status` radio Yes/No, `date` datetime) and 6 `defaultValue` rows (Influenza, Tdap, Zoster,
Pneumococcal, Hepatitis B, COVID-19).

`Wellness Lite_HRA` (gid 314943004) has **13 `__json__` rows**: `mer` (5),
`opt_in_consent` (2), `preventive_care` (2), `medication` (2),
`screening_questionnaire_depression` (1).
