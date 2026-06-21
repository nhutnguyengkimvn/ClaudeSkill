---
name: import-lab-recform
description: >
  Imports Lab Req Forms into the DNA Insights admin dashboard from explicit PDF
  paths. Invoked as `import-lab-recform <path1.pdf> [<path2.pdf> ...]`. Use this
  skill whenever the user says things like "import lab recform <file>.pdf",
  "run import-lab-recform on these PDFs", or "create medical req forms from these
  files". The skill validates every supplied path, asks for the dashboard URL,
  reads each PDF's content to detect its Test Type + Lab, then runs the
  per-recform pipeline (create Medical Specialty if missing → create ReqForm +
  sync CSV → flatten PDF + upload → create Form.io order services form) for each
  PDF in turn, pausing for user confirmation before moving to the next one.
---

# Import Lab Req Form

Imports Lab Req Forms into the DNA Insights admin dashboard, **one PDF at a
time, from explicit paths supplied by the user**.

## Invocation

```
import-lab-recform <path1.pdf> [<path2.pdf> ...]
```

- At least one PDF path is required.
- Paths may be absolute or relative (resolve relative paths against the current
  working directory).

## Output Language

**All user-facing output of this skill is in English** — regardless of the
chat/conversation language. This includes: queue reports, every step report,
confirmation-gate prompts, result lines, the final report, and the generated
HTML report. Do not localize these.

## Workflow Overview

```
Phase 0: Validate supplied paths + ask for Dashboard URL + detect type from PDF content
    ↓
For each PDF, in the order supplied:
    Setup: create `<recform-slug>/screenshots/` in the primary working dir NOW
       (slug from the ReqForm Description) so every step's screenshot is written
       straight into it — see `references/reporting.md`. No images outside the folder.
        ↓
    Pre-check: Does Medical Specialty exist?
        ↓ No  → Workflow 01: Create Medical Specialty
        ↓ Yes → skip
    Workflow 02: Create Req Form + Sync CSV
        ↓
    Workflow 03: Flatten PDF via chosen method → Upload to dashboard
        ↓
    Workflow 04: Create Form.io order services form (full-read PDF via Claude
       Read tool → classify fields + business rules → confirm field list → build JSON → paste into
       builder → user checks → Save → open → screenshot Preview Form → link
       schema URL into ReqForm metadata)
        ↓
    Workflow 05 (Step 7): Final confirm + build per-recform HTML report
       (screenshots per step → <recform-slug>/report-<slug>.html)
        ↓
    🔒 CONFIRM GATE: report this recform's result, then ASK the user to
       confirm before continuing. Only move to the next requested recform
       AFTER the user confirms.
    ↓
Next PDF → repeat until queue empty
```

> **Per recform:** capture a screenshot at each step and produce one
> self-contained `<recform-slug>/` folder (with `screenshots/` +
> `report-<recform-slug>.html`) — finish it **before** the next PDF. See
> `references/reporting.md`.
>
> **Screenshots go straight into the folder.** Create `<recform-slug>/screenshots/`
> first, then `browser_take_screenshot(filename="<recform-slug>/screenshots/<NN>-<step>.png")`.
> Never leave report images in the project root or `.playwright-mcp/`.

## Reference Files

Load these as needed:
- `references/playwright-mcp-setup.md` — Browser automation via Playwright MCP (login + tool mapping)
- `references/content-detection-rules.md` — Detect Test Type + Lab from PDF content
- `references/abbreviation-map.md` — Form Title → Short Code + Lab normalization
- `references/metadata-template.json` — Metadata JSON for Medical Specialty
- `references/order-services-formio-template.json` — Annotated Form.io schema skeleton for Workflow 04
- `references/field-taxonomy.md` — Workflow 04: classify reqform fields (EMR-prepopulated / provider-input / fixed), business rules, the 3 fixed fields, ICD-10 routing map
- `references/reporting.md` — Per-recform folder, screenshots, and HTML report
- `references/error-handling.md` — Error cases and responses
- `scripts/detect-recform-type.py` — Helper that extracts title + lab hints from a PDF
- `scripts/build-report.py` — Builds the self-contained per-recform HTML report

## Browser Automation

All browser steps (navigate / click / type / upload / read URL) run through the
**Playwright MCP** server (`playwright`). See `references/playwright-mcp-setup.md`
for the config, the one-time login, and the tool mapping. Use a single
persistent browser context for the whole run. Take a `browser_take_screenshot`
at each step for the report (see `references/reporting.md`).

## Workflow Files

Follow each in order per PDF:
- `workflows/01-create-specialty.md` — Section 0: Create Medical Specialty
- `workflows/02-create-reqform.md` — Section 1: Create Req Form + Sync CSV
- `workflows/03-flatten-upload.md` — Section 2: Flatten PDF + Upload
- `workflows/04-create-order-services-form.md` — Section 3: Create Form.io order services form
- `workflows/05-final-confirm-and-report.md` — Step 7: Final confirm + per-recform HTML report

## Phase 0 — Validate Inputs

1. **Check arguments were supplied.**
   - If no PDF path was given → report `❌ No PDF path supplied. Usage: import-lab-recform <path1.pdf> [<path2.pdf> ...]` and **STOP.**

2. **Validate EVERY supplied path before processing any of them.**
   For each path, check that:
   - the file exists, AND
   - it ends with `.pdf` (case-insensitive).
   - If **any** path is missing or not a PDF → report each invalid path like
     `❌ Invalid path: <path> (not found / not a PDF)` and **STOP.** Do not
     process a partial queue.

3. **Ask the user for the Dashboard base URL** (used in all workflows):
   ```
   What is the dashboard base URL to use? (e.g. https://dev-dashboard.dnainsights.ai)
   ```
   - Store the answer as `<DASHBOARD_URL>` and substitute it everywhere the
     workflows reference `<DASHBOARD_URL>`. Strip any trailing `/`.
   - Also derive the **environment tag** `<ENV>` from the URL (used in Workflow 04):
     host contains `dev`/`staging` → `[DEV]`, otherwise → `[PROD]`.
   - Wait for the answer before continuing.

4. **Ensure the browser is ready (Playwright MCP).** Follow the first-run login
   in `references/playwright-mcp-setup.md`: confirm the `playwright` MCP is
   available, then make sure both `<DASHBOARD_URL>/admin/` and
   `https://docs.google.com` are logged in (ask the user to log in once in the
   opened window if needed). The persistent profile keeps the session for later.

5. Load `references/content-detection-rules.md`, then for **each** PDF detect
   its Test Type + Lab by reading the PDF **content** (run
   `scripts/detect-recform-type.py` and map the result via
   `references/abbreviation-map.md`). Do NOT rely on the filename.

6. **Report the full queue** with detected values (Test Type, Lab, Short Code,
   derived names) and the chosen `<DASHBOARD_URL>` before starting. This is the
   processing queue, in the order supplied. If any detection is uncertain, show
   it and ask the user to confirm/correct before proceeding.

## Per-Recform Confirmation Gate

After completing all workflows for one PDF (including Workflow 05, which builds
the `<recform-slug>/` folder + HTML report):

1. Report that recform's result line (see Final Report Format) and the path to
   `<recform-slug>/report-<recform-slug>.html`.
2. Ask the user:
   ```
   ✅ Done with <filename>.pdf. Continue to the next recform? (yes / stop)
   ```
3. **Only proceed to the next PDF AFTER the user confirms.** If the user says
   stop → end the run and print the final report for what was processed so far.

## Final Report Format

After all PDFs processed (or the user stops):
```
✅ Immunodeficiency Panel - Amedix Inc.pdf → S0 skipped | S1 ✅ | Sync ✅ | S2 ✅ | S3 ✅
✅ CGX rec_Amedix.pdf → S0 ✅ (CGX-2026 created) | S1 ✅ | Sync ✅ | S2 ✅ | S3 ✅
❌ SomePDF.pdf → Failed at S1 (reason: ...)
Total: X success, Y failed
```
(S3 = Workflow 04 order services form. Mark `S3 ⏸` if the user deferred the
form review without saving.)
