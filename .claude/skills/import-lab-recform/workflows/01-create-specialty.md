# Workflow 01 — Create Medical Specialty

> Run this only if Pre-check confirms the Medical Specialty does NOT exist.
> Load `references/abbreviation-map.md` before starting.
> `<DASHBOARD_URL>` = the base URL the user supplied in Phase 0.

## Pre-check

1. Navigate to: `<DASHBOARD_URL>/admin/ehealth/medicalspeciality/`
2. Search for `<SHORTCODE> 2026` (e.g. `CGX 2026`)
3. **Found** → skip this workflow, go to Workflow 02
4. **Not found** → continue below

## Steps

### A. Navigate to Add page
`<DASHBOARD_URL>/admin/ehealth/medicalspeciality/add/`

### B. Fill fields

| Field | Value |
|-------|-------|
| Medical Specialty Service | select `Genetic 2026` from dropdown |
| Key | `tt-<shortcode_lowercase>-2026` (e.g. `tt-cgx-2026`) |
| Git Sync Key | same as Key |
| Name | `<SHORTCODE>-2026` (e.g. `CGX-2026`) |
| Display Name | `<SHORTCODE>` (e.g. `CGX`) |
| Sheet ID | `1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374` |
| Description | same as Name (e.g. `CGX-2026`) |
| Is Active | ✅ CHECK ON |

> **`SOAP Note Template` is a REQUIRED field** (the form won't save without it,
> even though it's easy to miss). Copy a known-good template from an existing
> `<X> 2026` Genetic specialty (e.g. open `IMMUNODEFICIENCY 2026`'s change page,
> read its `#id_soap_note_template_textarea`, and paste the same JSON). Tip: stash
> it in `localStorage` so it survives the navigation back to the Add page.

### C. Find Sheet Name (gid)

1. Open new tab → navigate to:
   `https://docs.google.com/spreadsheets/d/1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374`
2. Look for tab named **EXACTLY** `tt <SHORTCODE>` (e.g. `tt CGX`, `tt IMMUNO`, `tt NEURO`)
3. **Tab exists:**
   - Click it → read `gid` from URL (e.g. `...#gid=302070793`)
   - Use gid as Sheet Name value
4. **Tab missing:**
   - Find tab named `tt Wellness`
   - Right-click → Duplicate
   - Rename duplicated tab to `tt <SHORTCODE>`
   - Read new gid from URL
   - Use new gid as Sheet Name value
5. Go back to form → fill `Sheet Name` field with gid number only

### D. Fill Metadata

Paste the full contents of `references/metadata-template.json` into the Metadata field exactly as-is. Do not modify.

### E. Save

- Click `Save`
- Wait for success confirmation
- Report `✅ Workflow 01 done: <SHORTCODE>-2026 created`
- Continue to Workflow 02
