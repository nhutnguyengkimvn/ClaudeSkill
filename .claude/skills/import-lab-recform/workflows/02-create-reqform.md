# Workflow 02 — Create Req Form

> Load `references/abbreviation-map.md` before starting.
> `<DASHBOARD_URL>` = the base URL the user supplied in Phase 0.

## Year to use

Before filling any form fields, determine `<YEAR>`:
1. Use the current calendar year by default.
2. Ask the user once per batch run (not per PDF):
   ```
   Which year should be used for Medical Specialty and Req Form names? (default: <current year>)
   ```
3. Wait for the answer; use their reply (or the current year if they confirm the default).
4. Substitute `<YEAR>` everywhere `2026` appeared in earlier instructions.

## Steps

### 1. Navigate to Add page
`<DASHBOARD_URL>/admin/ehealth/medicalrecform/add/`

### 2. Fill basic fields

| Field | Value |
|-------|-------|
| Name | Lab name (e.g. `Amedix`) |
| Description | e.g. `CGX - Amedix <YEAR>` |

### 3. Medical Specific dropdown
- Click dropdown → type Short Code (e.g. `CGX`, `IMMUNO`, `PGX`)
- Wait for results → select option containing `<YEAR>`
- **Not found** → mark ❌, skip entire cycle for this PDF

### 4. Lab dropdown
- Click dropdown → type Lab name (e.g. `Amedix`)
- Select matching option

### 5. Sheet ID
Fill with: `1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374`

### 6. Find Sheet Name (gid) for ReqForm

1. Open new tab → navigate to:
   `https://docs.google.com/spreadsheets/d/1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374`
2. Look for tab named **EXACTLY** `<SHORTCODE> <Lab>` (e.g. `CGX Amedix`, `IMMUNO Amedix`)
3. **Tab exists:**
   - Click it → read `gid` from URL
   - Use gid as Sheet Name value
4. **Tab missing:**
   - Find tab named `PGX Hightech`
   - Right-click → Duplicate
   - Rename to `<SHORTCODE> <Lab>` (e.g. `CGX Amedix`)
   - Read new gid from URL
   - Use new gid as Sheet Name value
5. Go back to form → fill `Sheet Name` with gid number only

### 7. Is Default
Make sure checkbox is **UNCHECKED**

### 8. Save
- Click `Save`
- **If 500 error:**
  - Go back to form
  - Change `Name` field → full Description (e.g. `CGX - Amedix <YEAR>`)
  - Click `Save` again
  - **Still 500** → mark ❌, skip entire cycle
- Wait for success confirmation
- Report `✅ Workflow 02 done: ReqForm saved`
- Continue to Workflow 03

> **Sync CSV runs after Workflow 04**, not here. Do not trigger it now.
