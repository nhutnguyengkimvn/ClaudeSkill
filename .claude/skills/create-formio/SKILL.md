---
name: create-formio
description: >
  Standalone Form.io order-services form creator. Reads a lab PDF, classifies
  its fields, and builds + saves the Form.io JSON schema in the dashboard
  builder — without running the full import-lab-recform pipeline. Use when
  W01–W03 are already done and only the Form.io form needs to be created or
  re-created for a recform.
---

# Create Form.io Order Services Form

Creates the Form.io "order services" schema form for a lab PDF by running
**W04 of import-lab-recform** as a standalone operation.

## Invocation

```
create-formio <path.pdf> [--dashboard <url>] [--recform-slug <slug>]
```

- `<path.pdf>` — source PDF (with text layer, NOT flattened copy).
- `--dashboard <url>` — dashboard base URL (e.g. `https://dev-dashboard.dnainsights.ai`).
  If omitted, ask the user.
- `--recform-slug <slug>` — project folder slug (e.g. `neuro-alpha-dera-2026`).
  If omitted, derive from PDF filename.

## Output Language

All user-facing output is in **English**.

---

## Phase 0 — Validate inputs

1. Confirm `<path.pdf>` exists and ends with `.pdf`. If missing → `❌ No PDF path.` STOP.
2. Ask for `--dashboard` if not supplied.
3. Derive `<ENV>` from URL: host contains `dev`/`staging` → `[DEV]`, else `[PROD]`.
4. Derive `<recform-slug>` if not supplied: lowercase PDF filename, replace spaces/dots
   with hyphens, strip `.pdf`, e.g. `neuro-alpha-dera-2026`.
5. Detect Test Type + Lab: run
   `.claude/skills/import-lab-recform/scripts/detect-recform-type.py <path.pdf>`
   and map via `.claude/skills/import-lab-recform/references/abbreviation-map.md`.
6. Confirm detection with user before proceeding.

---

## Step 1 — Run W04 (Form.io creation)

Load and execute `.claude/skills/import-lab-recform/workflows/04-create-order-services-form.md`
with the following context variables already set:

| Variable | Value |
|----------|-------|
| `<DASHBOARD_URL>` | from Phase 0 |
| `<ENV>` | derived from URL |
| `<PDF_PATH>` | from arg |
| `<recform-slug>` | from Phase 0 |
| `<TestType>` | from detection |
| `<Lab>` | from detection |

Follow every step of W04 exactly (open builder → find reference form → read full
PDF → classify fields → confirm with user → build JSON → paste → save → screenshot
→ link schema → export CSV → sync CSV).

---

## Step 2 — Report

```
✅ create-formio done
   Form:        [DEV] [AI] order services <TestType> <Lab>
   Schema URL:  <SCHEMA_URL>
   CSV:         <recform-slug>/order-services-<slug>.csv
   Screenshot:  <recform-slug>/screenshots/06-formio-form.png
```
