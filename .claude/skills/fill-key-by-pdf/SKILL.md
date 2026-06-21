---
name: fill-key-by-pdf
description: >
  Fills PDF form field keys in the Foxit PDF Builder admin from a matching
  Form.io order-services form. Invoked as `fill-key-by-pdf <path.pdf>
  [<dashboard_url>]`. Given a lab PDF, detects the test type + lab, finds the
  matching Form.io form to collect its component keys, maps them to PDF-builder
  keys (order_service_* → test_requirements_*), then opens the Foxit PDF
  Builder admin, locates the reqform PDF, and adds any missing keys via the
  "Add Signature" button — leaving existing keys untouched.
---

# Fill Key by PDF

Fills PDF form field keys in the **Foxit PDF Builder** admin by reading the
matching **Form.io order-services form** and applying the canonical key mapping
(`order_service_*` → `test_requirements_*`).

## Invocation

```
fill-key-by-pdf <path.pdf> [<dashboard_url>]
```

- `<path.pdf>` — absolute path to the source lab PDF (used for detection only).
- `<dashboard_url>` — optional; if omitted, the skill asks for it.

## Output Language

**All user-facing output is in English**, regardless of conversation language.

## Workflow Overview

```
Phase 0: Validate PDF path + ask for Dashboard URL
    ↓
Phase 1 (Workflow 01): Detect test type + lab from PDF content
    → Search Form.io builder for matching order-services form
    → Extract all component keys from its Firebase schema
    ↓
Phase 2 (Workflow 02): Apply key-mapping rules → build target key list
    → Show FULL mapping table (Form.io key → PDF builder key)
    → 🔒 CONFIRM GATE: user reviews the table, corrects if needed
    ↓
Phase 3 (Workflow 03): Open Foxit PDF Builder admin
    → Search for the reqform PDF by lab + test type name
    → Read existing keys already present in the left panel
    → For each target key:
        • Already exists → SKIP (log it)
        • Missing        → Add Signature → set key name
    → 🔒 CONFIRM GATE before adding each new batch
    ↓
Final: Print summary (keys added / skipped / failed)
```

## Reference Files

- `references/key-mapping-rules.md` — canonical Form.io → PDF-builder key map
- `references/field-type-rules.md` — how to handle each field category (signatures, ICD codes, EMR fields)
- `references/playwright-mcp-setup.md` (shared from import-lab-recform) — browser automation

## Workflow Files

Follow each in order:
- `workflows/01-detect-and-fetch-formio-keys.md` — detect PDF type, find + read Form.io schema
- `workflows/02-map-and-confirm-keys.md` — apply mapping, show table, confirm with user
- `workflows/03-fill-pdf-builder.md` — open Foxit PDF builder, add missing keys

## Phase 0 — Validate Inputs

1. **Check PDF path was supplied.**
   - If missing → `❌ No PDF path. Usage: fill-key-by-pdf <path.pdf>` and STOP.

2. **Validate the path.**
   - File must exist AND end with `.pdf` (case-insensitive).
   - If invalid → `❌ Invalid path: <path> (not found / not a PDF)` and STOP.

3. **Confirm Dashboard URL** using `AskUserQuestion` with two fixed options:
   - `https://dev-dashboard.dnainsights.ai` (DEV)
   - `https://dashboard.dnainsights.ai` (PROD)

   If already provided as second argument, skip the prompt and use it directly.
   Derive `<ENV>`: `dev-dashboard` → `[DEV]`, `dashboard` (no dev) → `[PROD]`.

4. **Ensure Playwright MCP browser is ready** — navigate to `<DASHBOARD_URL>/admin/`
   and confirm the session is logged in (ask user to log in if needed).

## Final Summary Format

```
PDF:       Metabolic Disorders Panel - Amedix Inc.pdf
Form.io:   [DEV] [AI] order services Metabolic Amedix
ReqForm:   METABOLIC - Amedix 2026

Keys added (N):
  ✅ test_requirements_test_order_panel
  ✅ test_requirements_test_order_parameters_1
  ...

Keys already present — skipped (N):
  ⏭️  test_requirements_test_order_medical_review
  ...

Keys failed (N):
  ❌ <key> — <reason>
```
