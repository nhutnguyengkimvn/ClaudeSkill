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
4. If it ever gets to writing: snapshot the old values to a file first so the change is
   reversible, and verify every cell after writing.

## Allowed without asking

Reading the sheet (CSV/gviz), diffing, analysing, building previews, generating JSON,
emitting specs/changesets, reporting data errors. All read-only.

## Related

- `.claude/skills/analyze-clickup-task/knowledge/core-platform-map.md` — column layout,
  what AD/AE mean, `__json__` rows.
- `.claude/skills/analyze-clickup-task/knowledge/learned-rules.md` — wrong conclusions
  previously drawn about this sheet and the rules that came out of them.
