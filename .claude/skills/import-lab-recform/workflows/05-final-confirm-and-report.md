# Workflow 05 — Final Confirm & Report (Step 7)

> Runs after Workflow 04, as the last step for each recform, before the
> per-recform confirmation gate. Produces the recform's folder + HTML report.
> See `references/reporting.md` for the folder layout, slug, screenshot capture,
> and the build-report script.

## Step 7 — Final confirm (review the finished recform)

1. Show the finished recform to the user for review. Navigate to and screenshot
   the relevant pages:
   - ReqForm change page (`<DASHBOARD_URL>/admin/ehealth/medicalrecform/?q=<Description>`)
   - Uploaded PDF (`<DASHBOARD_URL>/admin/ehealth/medicalpdf/?q=<Description>`)
   - The Form.io order services form (builder, and the front-end preview URL if
     available)
2. Capture `07-final-confirm-before.png` (state shown to the user).
3. **Ask the user to confirm** the finished recform looks correct.
4. After they confirm (or after applying any last fixes), capture
   `07-final-confirm-after.png`.

## Build the report

1. The recform folder + `screenshots/` was already created at the start of this
   PDF (see `references/reporting.md` → "Create the recform folder FIRST"), and
   every screenshot was written **directly** into `<recform-slug>/screenshots/`
   via the `filename` path — so there is **nothing to copy** here. Just confirm
   all expected screenshots are present in the folder (and that none were left in
   the project root / `.playwright-mcp/`; `mv` any stray ones in).
2. Assemble `<recform-slug>/report-manifest.json` covering all 7 steps with their
   outcomes and screenshot filenames (manifest schema in
   `scripts/build-report.py`). Include recform name, MSS, Test Type, Lab, source
   PDF path, dashboard URL.
3. Run `scripts/build-report.py` on the manifest to generate
   `report-<recform-slug>.html`.
4. Report the HTML path to the user, then proceed to the per-recform
   confirmation gate in SKILL.md.

> Each recform gets its **own** `<recform-slug>/` folder. Finish (and report) the
> current recform fully before starting the next requested PDF.
