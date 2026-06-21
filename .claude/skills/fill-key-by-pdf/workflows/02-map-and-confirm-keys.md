# Workflow 02 — Map Keys & Confirm with User

> Applies the key-mapping rules to transform Form.io keys into PDF-builder
> target keys, then shows a full table and waits for user confirmation.

## Step 1 — Load mapping rules

Read `references/key-mapping-rules.md` and `references/field-type-rules.md`
(this skill's references folder).

## Step 2 — Apply mapping algorithm

For each key collected in Workflow 01, follow the algorithm from
`references/key-mapping-rules.md`:

1. Skip structural/infrastructure keys (button, content, htmlelement layout
   components; `order_service_instructions`;
   `order_service_additional_clinical_context`; `submit`).
2. Apply special-case table first (exact match).
3. Apply general rule (`order_service_<suffix>` → `test_requirements_<suffix>`)
   for remaining keys.
4. Keys already in `test_requirements_*` form → keep target = source.
5. Anything else → mark `action: "confirm"` for user review.

## Step 3 — Build the mapping table

Group results into three sections and print them **as a code block** (labels
may contain `|`):

```
MAPPING TABLE — Form.io → PDF Builder
======================================

[ADD — will be added to PDF builder]
  SOURCE KEY (Form.io)                       →  TARGET KEY (PDF builder)
  order_service_test_panel                   →  test_requirements_test_order_panel
  order_service_test_parameters_1            →  test_requirements_test_order_parameters_1
  order_service_test_parameters_2            →  test_requirements_test_order_parameters_2
  order_service_overread                     →  test_requirements_test_order_overread
  order_service_reason_for_exam              →  test_requirements_test_order_reason
  order_service_clinical_history             →  test_requirements_clinical_history
  ...

[SKIP — structural / infrastructure, will not be added]
  order_service_instructions                 (display-only)
  order_service_additional_clinical_context  (system-populated)
  submit                                     (button)
  ...

[HANDLED SEPARATELY — not in this mapping table]
  Patient signature stubs (signature_<digits>)   → DELETE in W03 Step 4
  Physician signature                             → ADD SIGNATURE button in W03 Step 5
  ICD code fields                                 → GENERATED in W03 Step 6 (per-panel or global)

[NEEDS CONFIRMATION — unusual key prefix]
  some_other_key                             →  ??? (please advise)
```

## Step 4 — 🔒 CONFIRM GATE

Ask the user:

```
Does the mapping table above look correct?
- Type "ok" to proceed with adding the [ADD] keys.
- Type corrections inline (e.g. "rename order_service_foo → test_requirements_bar").
- Type "skip <key>" to exclude a key from the ADD list.
```

Wait for confirmation. Apply any corrections the user specifies, regenerate the
table if changes were made, and confirm again before proceeding.

After confirmation, produce the final `target_keys[]` list — the ordered list
of PDF-builder key names to add — and pass it to Workflow 03.

## Output to Workflow 03

```
target_keys = [
  "test_requirements_test_order_panel",
  "test_requirements_test_order_parameters_1",
  "test_requirements_test_order_parameters_2",
  "test_requirements_test_order_overread",
  "test_requirements_test_order_reason",
  "test_requirements_test_order_medical_review",
  "test_requirements_clinical_history",
  ...
]
```
