# Workflow 02 — Create Req Form + Sync CSV

> Load `references/abbreviation-map.md` before starting.
> `<DASHBOARD_URL>` = the base URL the user supplied in Phase 0.

## Steps

### 1. Navigate to Add page
`<DASHBOARD_URL>/admin/ehealth/medicalrecform/add/`

### 2. Fill basic fields

| Field | Value |
|-------|-------|
| Name | Lab name (e.g. `Amedix`) |
| Description | e.g. `CGX - Amedix 2026` |

### 3. Medical Specific dropdown
- Click dropdown → type Short Code (e.g. `CGX`, `IMMUNO`, `PGX`)
- Wait for results → select option containing `2026`
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
  - Change `Name` field → full Description (e.g. `CGX - Amedix 2026`)
  - Click `Save` again
  - **Still 500** → mark ❌, skip entire cycle
- Wait for success confirmation
- Report `✅ ReqForm saved`

### 9. Verify & Sync CSV
1. Navigate to: `<DASHBOARD_URL>/admin/ehealth/medicalrecform/`
2. Find the newly created form (match by Description e.g. `CGX - Amedix 2026`)
3. Check the checkbox next to it
4. Open `Action` dropdown → select `Sync CSV`
5. Click `Go`
6. Wait for message: `Syncing process has been started! You can look over it from Sequence Tracker`
7. Report `✅ Workflow 02 done + Sync CSV triggered`
8. Continue to Workflow 03
