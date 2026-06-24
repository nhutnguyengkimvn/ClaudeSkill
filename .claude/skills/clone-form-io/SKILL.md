---
name: clone-form-io
description: >
  Clones an existing Form.io order-services form and renames/modifies it for a
  different lab or test type. Use when a new form is very similar to an existing
  one — clone it, rename, and patch only the parts that differ (panel names, gene
  lists, questionnaire fields). Invoked as `clone-form-io <source-form-name>`.
  Always checks whether the target clone already exists before cloning.
---

# Clone Form.io Form

Clones an existing Form.io order-services form and modifies it for a new
lab / test type — faster than building from scratch when the structure is
similar.

## Invocation

```
clone-form-io <source-form-name>
```

- `<source-form-name>` — name (or partial name) of the Form.io form to clone
  from (e.g. `order services CGX Amedix`, `order services Neuro Amedix`).
- If omitted, the skill lists available forms and asks the user to choose.

## Output Language

All user-facing output is in **English**.

---

## Phase 0 — Validate & confirm source

1. Open the Form.io builder: navigate to `<DASHBOARD_URL>/admin/formio-dev-builder/`.
   - `<DASHBOARD_URL>` must be known from prior pipeline context or ask the user.
2. In the **Forms** search, type the `<source-form-name>` argument.
3. If **no match** → list the top-10 forms and ask the user to pick one. STOP if
   they decline.
4. If **multiple matches** → show them all and ask the user to confirm which one
   to clone.
5. Open the matched form (click its row in the list) to load it in the builder.
   Confirm the **Form Name** shown in the header matches expectations.
6. Note the source form's **Apis to Get Schema** URL for reference.

---

## Phase 1 — Determine target name

1. Ask the user:
   > "What should the cloned form be named?
   > Current naming convention: `[ENV] [AI] order services <TestType> <Lab>`
   > Example: `[DEV] [AI] order services Neuro Alpha Dera`"
2. Derive `<ENV>` from the dashboard URL if not explicitly given.
3. Record the user's answer as `<target-name>`.

---

## Phase 2 — Idempotency check (clone only once)

1. In the Forms search, type `<target-name>` exactly.
2. **If a form with that exact name already exists:**
   - Report: `⚠️ Form "<target-name>" already exists.`
   - Ask:
     > "The target form already exists. Do you want to:
     > (a) Edit the existing form instead of cloning again
     > (b) Cancel"
   - If (a) → skip to **Phase 4** (load and modify the existing form).
   - If (b) → STOP.
3. **If not found** → continue to Phase 3.

---

## Phase 3 — Clone the source form

1. Go back to the source form (re-select it from the Forms list if needed).
2. Click the **Clone** button in the builder toolbar.
3. Wait for the clone to be created. The builder typically auto-names it
   something like `Copy of <source-form-name>`.
4. In the **Edit Json Schema** editor, update the top-level `"name"` field to
   `<target-name>`.
5. Click **Save**.
6. Confirm the form now appears in the Forms list under `<target-name>`.

---

## Phase 4 — Modify the cloned form

> Goal: patch only what differs between the source and the target form.
> Do NOT rebuild the form from scratch.

### 4a — Fetch the current JSON

Fetch the schema via the **Apis to Get Schema** URL of the cloned/target form
(shown in the builder after selecting it). Save to `/tmp/clone-<slug>.json`.

### 4b — Ask the user what to modify

Report what the source form contained (panels, parameters, questionnaire sections)
and ask:

> "The cloned form is ready. What would you like to modify?
> Common changes:
>   1. Form name (top-level `name`) — already updated to `<target-name>`
>   2. Test Panel options (panel names, add/remove panels)
>   3. Test Parameters per panel (gene lists)
>   4. Clinical questionnaire fields (add/remove/relabel)
>   5. Nothing — save as-is
>
> Please describe the changes, or say 'none' to save as-is."

### 4c — Apply changes

For each change the user requests:
- **Panel rename**: update `label` and `value` in `order_service_test_panel.data.values[]`
  AND in every matching `customConditional` / `validate.custom` / `calculateValue` expression.
- **Gene list update**: replace `values[]` in the relevant `order_service_test_parameters_<N>` component.
- **Questionnaire field change**: add/remove/edit components in the `components` array.
- **Form name already done** in Phase 3.

After applying changes, show the user a summary diff (what changed) and ask for
confirmation. Re-apply if they request further tweaks.

### 4d — Paste updated JSON

1. In the builder, with the target form selected, switch to **Edit Json Schema**.
2. Paste the modified JSON using the Monaco model API:
   ```js
   window.monaco.editor.getModels()[0].setValue(<json>)
   ```
   (Do NOT set a textarea value — the editor is Monaco inside a cross-origin iframe.)
3. Click **Save**.

---

## Phase 5 — Verify & screenshot

1. Select the saved form from the Forms list, switch to **Preview Form**.
2. Collapse the dashboard left sidebar to avoid overlap.
3. Take a full-page screenshot. Save as `<recform-slug>/screenshots/06-formio-form.png`
   if inside an import-lab-recform pipeline, otherwise save to the CWD with a
   descriptive name (`clone-<target-slug>-preview.png`).
4. Report the **Apis to Get Schema** URL for wiring into the ReqForm metadata.

---

## Phase 6 — Report

```
✅ clone-form-io done
   Source:      <source-form-name>
   Clone:       <target-name>
   Schema URL:  <SCHEMA_URL>
   Screenshot:  <screenshot-path>
   Modifications: <summary of what was changed>
```

If the form will be used in an import-lab-recform pipeline:
- Wire the schema URL into the ReqForm metadata (W04 step 10).
- Export CSV and sync (W04 steps 11–12).
