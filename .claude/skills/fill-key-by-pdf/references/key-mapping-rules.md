# Key Mapping Rules — Form.io → PDF Builder

> The Form.io order-services form uses `order_service_*` key names.
> The Foxit PDF Builder reqform needs `test_requirements_*` key names.
> This table defines the exact mapping for known special-case keys; the
> general rule covers everything else.

## Special-case mappings (exact match, apply first)

| Form.io key (source) | PDF builder key (target) |
|---|---|
| `order_service_test_panel` | `test_requirements_test_order_panel` |
| `order_service_test_parameters` | `test_requirements_test_order_parameters` |
| `order_service_test_parameters_<N>` | `test_requirements_test_order_parameters_<N>` |
| `order_service_overread` | `test_requirements_test_order_overread` |
| `order_service_reason_for_exam` | `test_requirements_test_order_reason` |
| `test_requirements_test_order_medical_review` | `test_requirements_test_order_medical_review` *(unchanged)* |

## General rule (apply to all remaining keys)

For any key **not** matched above:

```
order_service_<suffix>  →  test_requirements_<suffix>
```

If the key does **not** start with `order_service_` and is also not a
`test_requirements_*` key → **flag it for user confirmation** before adding.

## Keys to SKIP (never add to PDF builder)

These Form.io infrastructure keys have no PDF-builder equivalent:

- `submit` (submit button)
- Any key with type `button`, `content`, `htmlelement`, `well`, `columns`, `panel`
  (structural/layout-only components — they carry no value in the PDF).
- `order_service_instructions` (fixed display-only field)
- `order_service_additional_clinical_context` (system-populated)

## Notes on `_<N>` indexed keys

Form.io encodes multi-panel test parameters as:
- `order_service_test_parameters_1`, `order_service_test_parameters_2`, …

Apply the special-case rule for each indexed variant:
`order_service_test_parameters_<N>` → `test_requirements_test_order_parameters_<N>`

The PDF builder needs one key per panel index. When looping through Form.io
components, collect ALL `order_service_test_parameters_*` variants and include
them all in the mapping table.

## Mapping algorithm (step by step)

1. Collect every component key from the Form.io schema (flatten nested
   components recursively — check `components[]` on `panel`, `columns`,
   `fieldset`, `well` types).
2. Remove structural/skip keys (see "Keys to SKIP" above).
3. For each remaining key:
   a. Check special-case table (exact match including `_<N>` suffix).
   b. If no match and starts with `order_service_` → apply general rule.
   c. If no match and already `test_requirements_*` → keep as-is (target = source).
   d. Otherwise → flag for user.
4. Deduplicate the target list (same target from different source keys → warn user).
5. Output: list of `{ source_key, target_key, action: "add"|"skip"|"confirm" }`.
