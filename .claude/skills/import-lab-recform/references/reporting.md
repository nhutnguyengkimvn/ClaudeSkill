# Per-Recform Reporting

Each recform produces its **own self-contained folder** with screenshots + an
HTML report. Do this for **each recform independently**, completing its folder
**before** moving on to the next requested recform.

## Folder layout (in the current working directory)

```
<recform-slug>/
├── screenshots/
│   ├── 01-create-specialty.png
│   ├── 02-create-reqform.png
│   ├── 03-sync-csv.png
│   ├── 05-import-pdf.png
│   ├── 06-formio-form.png          # Preview Form view, full height to Submit
│   ├── 06b-reqform-metadata.png    # ReqForm Metadata with order_form_link
│   ├── 06c-test-panels.png         # optional: Test Panel dropdown expanded (shows all panel options)
│   ├── 07-final-confirm-before.png
│   └── 07-final-confirm-after.png
├── report-manifest.json
└── report-<recform-slug>.html
```

- `<recform-slug>` = slugify the ReqForm Description: lowercase, replace any run
  of non-alphanumeric chars with `-`, trim leading/trailing `-`.
  `PGX - Amedix 2026` → `pgx-amedix-2026`.
- All report asset paths are **relative** (`./screenshots/...`) so the folder is
  portable when opened or moved as a unit.

## Create the recform folder FIRST (before any screenshot)

The `<recform-slug>` is known as soon as the ReqForm Description is derived in
Phase 0 (slugify it — `METABOLIC - Amedix 2026` → `metabolic-amedix-2026`). At
the **start** of processing each PDF (before Workflow 01), create the folder so
every screenshot can be written straight into it:

```bash
mkdir -p "<recform-slug>/screenshots"
```

(Run this in the **primary working directory** — the same dir the Playwright MCP
writes to. That is where the finished `<recform-slug>/` folder must live.)

## Capturing screenshots — write DIRECTLY into the recform folder

**Never** save a report screenshot to the project root / `.playwright-mcp/` and
then copy it — that leaves stray image files outside the report folder. Instead
pass the recform-folder-relative path as the `filename`, so the image lands
inside `<recform-slug>/screenshots/` on the first write:

```
browser_take_screenshot(filename="<recform-slug>/screenshots/<NN>-<step>.png")
```

- The `filename` is resolved against the Playwright MCP output dir (= the primary
  working directory), so `metabolic-amedix-2026/screenshots/06-formio-form.png`
  writes into the recform folder directly. **No `cp` step.**
- The folder must already exist (see "Create the recform folder FIRST"); the MCP
  will not create missing parent dirs.
- The MCP's own page snapshots / console logs under `.playwright-mcp/` are
  internal artifacts — leave them; they are not report assets.

**Confirmation gates** (W02 save-retry, W04 review-before-save, Step 7): capture
**both** the state shown to the user (`...-before.png`) and the post-confirmation
state (`...-after.png`) — both written directly into the folder as above.

> If a screenshot ever does land outside the recform folder (e.g. a one-off
> `filename` without the folder prefix), move it in with `mv` so **no report
> image remains outside `<recform-slug>/`**.

## The 7 steps (report sections)

| # | Step | Source workflow | Typical outcome |
|---|------|-----------------|-----------------|
| 1 | Create Medical Specialty | W01 | success / skipped |
| 2 | Create ReqForm | W02 | success / changes-confirmed (on 500 retry) |
| 3 | Sync CSV | W02 | success |
| 4 | Flatten PDF | W03 | success (local; screenshot optional) |
| 5 | Import PDF | W03 | success |
| 6 | Create Form.io order services form | W04 | changes-confirmed / tbc (if deferred) — screenshot the **Preview Form** (full height to Submit); also link the schema URL into the ReqForm Metadata (`06b`) |
| 7 | Final confirm | W05 | success / changes-confirmed |

Outcome vocabulary (used in the manifest): `success`, `changes-confirmed`,
`skipped`, `failed`, `tbc`.

## Building the report

1. Assemble `report-manifest.json` in the recform folder (schema documented at
   the top of `scripts/build-report.py`): recform name, MSS (Medical Specialty
   Service, e.g. `Genetic 2026`), Test Type, Lab, source PDF path, dashboard URL,
   and a `steps[]` array (n, title, done, outcome, screenshots[], optional note,
   optional `decisions[]`).
   Leave `timestamp` out — the script stamps it in Asia/Ho_Chi_Minh (GMT+7).

### Record every decision (proposed vs chosen) — REQUIRED
Whenever a step involved a confirmation gate / `AskUserQuestion` (e.g. the
Dashboard URL, Short Code, key-conflict resolution, flatten method, the
Workflow-04 field-list / label-value confirmation, edit-vs-skip on an existing
form, or any value the user corrected), the report **MUST** show both **what was
proposed/recommended** and **what the user chose**. Add a `decisions[]` entry on
that step's manifest object:

```json
"decisions": [
  {
    "question": "Key 'tt-metabolic-2026' is taken — how to proceed?",
    "options": ["Use alt key tt-metabolic-2026-amedix", "Abort S0", "Use -v2 suffix"],
    "recommended": "Use alt key tt-metabolic-2026-amedix",
    "chosen": "Use alt key tt-metabolic-2026-amedix",
    "note": "Canonical key held by a soft-deleted/hidden Test Type."
  }
]
```

The builder renders these as a highlighted block per step (options list with
`recommended` and `✓ chosen` tags). This makes the report a complete audit trail
of every choice — never silently drop a decision the user made.
2. Run:
   ```bash
   ~/.claude/skills/.venv/bin/python3 \
     "<skill_dir>/scripts/build-report.py" "<recform-slug>/report-manifest.json"
   ```
   It writes `report-<recform-slug>.html` (self-contained, top summary, numbered
   sections, click-to-enlarge thumbnails via a pure-CSS lightbox).
3. Report the HTML path to the user.
