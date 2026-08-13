# Rule: never edit the Google field-mapping sheet automatically

Applies to the Core field-mapping sheet
(`1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374`) and any other form-config sheet.

## Forbidden

**Never write, edit, or delete any cell automatically** — not through Playwright, not
through Apps Script, not through the Sheets API, not through any script. Not even when the
user has just described the change, not even when the change is small and obvious, not even
mid-way through an edit you already started.

The sheet is the source of truth for the form running in production. One wrong cell removes
a field from the doctor's chart, and Google Sheets **cannot revert a single tab** — version
history is file-level. On 2026-08-12 eight Care Plan rows were lost and the whole file had
to be restored.

## Required

1. **Produce a plan first.** List every change explicitly: which tab, which section, which
   `field_key`, which column, old value → new value. For a new field, say which `field_key`
   it goes under and what each column gets.
2. **Wait for the user to approve.** "The user described a requirement" is NOT "the user
   approved the plan".
3. Even after approval, the default is to **emit a spec for the user (or another Claude
   session) to apply**. Only write to the sheet directly if the user says so explicitly in
   that same turn.
4. **A tab backup must exist before anything is written.** Version history is file-level, so
   the only way to revert one tab is a clone of that tab taken beforehand. The clone is made by
   the user from the **"Sheet backup" menu inside the backup spreadsheet** — as `<tab>__v<N>`,
   indexed on that file's first sheet: `sheet_name, version, backup_tab, backup_gid,
   source_gid, source_sheet_id, reason, task_id, rows, cols, created, by`. `/formio-preview` →
   backup only READS that index, links each row to its clone, and stamps the chosen version
   into the spec. A spec emitted without a
   backup carries `backup: null` plus a rule telling the applier to refuse — honour it, do not
   apply such a spec.
5. If it ever gets to writing: snapshot the old values to a file too, and verify every cell
   after writing.

## Restoring one tab

Never restore the whole FILE from Google's version history — that discards everyone else's
newer edits in other tabs (that is exactly how the 2026-08-12 loss got worse). Instead:
copy the backup tab back in the Google UI, or diff the backup tab against the live tab and
apply the **inverse spec** through the same reviewed path as any other change.

## Allowed without asking

Reading the sheet (CSV/gviz), diffing, analysing, building previews, generating JSON,
emitting specs/changesets, reporting data errors. All read-only.

## Related

- `.claude/skills/analyze-clickup-task/knowledge/core-platform-map.md` — column layout,
  what AD/AE mean, `__json__` rows.
- `.claude/skills/analyze-clickup-task/knowledge/learned-rules.md` — wrong conclusions
  previously drawn about this sheet and the rules that came out of them.
- `/Users/nhut/Documents/MyProject/DemoPage` — `tools/sheet-backup-webapp.gs` (the Apps Script
  that clones a tab; it only ever writes to the BACKUP file) and `assets/sheet-backup.js`
  (its browser client). Deploy steps are in the header of the `.gs` file.
