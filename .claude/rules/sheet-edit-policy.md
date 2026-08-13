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

## HOW to write, once all five conditions above are met

The grid is a **canvas** — there are no DOM cells to click, read, or fill. Everything below
was established by trial on 2026-08-13; do not re-derive it.

**Use `mcp__playwright__browser_run_code_unsafe`, and put the whole interaction in ONE call.**
That is the single most important part: between two separate MCP calls Sheets hands focus
back to some other element, so the next keystroke is swallowed as a global shortcut instead
of reaching the grid (a stray `X` opened File → Import on the production config sheet).

```js
async (page) => {
  await page.goto('https://docs.google.com/spreadsheets/d/<id>/edit?gid=<gid>#gid=<gid>');
  await page.waitForTimeout(6000);

  const goto = async (ref) => {
    const nb = page.locator('#t-name-box');   // NOT input.docs-omnibox-input
    await nb.click();                          // a real click first — this is what wires focus
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(ref);             // keyboard.type, not per-key press
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
  };

  await goto('A3');
  for (const value of row) {                   // one row, left to right
    await page.keyboard.type(value);
    await page.waitForTimeout(70);
    await page.keyboard.press('Tab');          // commits the cell and steps right
    await page.waitForTimeout(70);
  }
  await page.keyboard.press('Enter');
}
```

**Verify by re-reading the CSV export**, never by inspecting the DOM — the canvas holds no
cell state. `…/export?format=csv&gid=<gid>`, then diff cell by cell.

### What does NOT work — stop trying these

| Attempt | Outcome |
|---|---|
| `navigator.clipboard.writeText` | hangs ~120s on a permission prompt; had to be killed |
| `execCommand('copy')` + `⌘V` | copy returns `true`, paste never lands |
| synthetic `ClipboardEvent('paste')` | ignored — Sheets filters on `isTrusted` |
| Name box + type across separate MCP calls | focus drifts; keys become global shortcuts |
| `fill()` on `#waffle-rich-text-editor` | the editor only exists while a cell is being edited |
| `Shift+Space` then `⌘⌥=` to insert rows | silently does nothing |

## The backup file

`1rAmnKxYGxW27X2lpxDsA2FxnhwyzqXj-7rD9Ldpog3U` ("Backup"). Its first sheet is named `Menu`
and holds the index. As of 2026-08-13 its **"Sheet backup" Apps Script menu is not
installed**, so the documented clone route is unavailable; the substitute that worked is
Sheets → right-click tab → **Copy to → Existing spreadsheet** → rename to `<tab>__v<N>` →
append the index row with the recipe above. Verify a clone by diffing the SHA-256 of both
CSV exports — they must be byte-identical.

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
