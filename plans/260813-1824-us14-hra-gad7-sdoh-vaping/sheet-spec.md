# US14 — Core sheet changeset (awaiting approval)

Source: ClickUp doc page `2kzkhzvf-132578` + Figma `lokWk6PEldForU38xYPwqH`
(nodes 3877:8163, 3877:7755, 3877:8911, 3880:14592, 3880:14975, 3880:15075, 3880:15283).

Sheet: `1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374`

Template mapping confirmed by the user:
**Establish Care Visit = Wellness Lite** · **Annual Wellness Visit = Wellness**

## RULE — do not apply without both of these

1. This spec is approved by the user in the same turn as the write.
2. A backup tab `<tab>__v<N>` exists, made from the **"Sheet backup" menu inside the backup
   spreadsheet**, and its version is stamped below.

```
backup:
  Wellness_HRA:       v1   # Backup file tab "Wellness_HRA__v1"       gid 1787481372
  Wellness Lite_HRA:  v1   # Backup file tab "Wellness Lite_HRA__v1"  gid 1235222332
```

Backup file: `1rAmnKxYGxW27X2lpxDsA2FxnhwyzqXj-7rD9Ldpog3U` ("Backup").

Taken 2026-08-13 by cloning each tab with **Sheets → right-click tab → Copy to → Existing
spreadsheet**, then renaming to `<tab>__v1`. The file's "Sheet backup" Apps Script menu was
not installed at the time, so the documented menu route was unavailable; the user approved
this substitute. Both clones were verified **byte-identical** to their source tabs
(`Wellness_HRA` 192 rows, `Wellness Lite_HRA` 163 rows) by diffing the CSV exports.

Still outstanding: the two index rows in the backup file's `Menu` sheet have NOT been
appended, so the clones are not registered. Reinstalling the Apps Script menu would also fix
future backups.

---

## Change 1 — Tobacco labels (2 tabs, 4 cells)

Column `Label` only. `Field Type`, `Values`, role config unchanged.

| Tab | field_key | Column | Old | New |
|---|---|---|---|---|
| `Wellness_HRA` | `social_history_screening_smoke` | Label | `Do you currently smoke?` | `Do you currently smoke/vape?` |
| `Wellness_HRA` | `social_history_screening_smoke_yes` | Label | `If yes, how many cigarettes do you smoke per day?` | `If yes, how many cigarettes or vaping uses per day?` |
| `Wellness Lite_HRA` | `social_history_screening_smoke` | Label | `Do you currently smoke?` | `Do you currently smoke/vape?` |
| `Wellness Lite_HRA` | `social_history_screening_smoke_yes` | Label | `If yes, how many cigarettes do you smoke per day?` | `If yes, how many cigarettes or vaping uses per day?` |

NOT changed (design already matches the sheet): `social_history_screening_quitting_smoking`
(`Yes;Not right now;No`), heading `alcohol_screening_content4` (`B. Tobacco Use`).

---

## Change 2 — GAD-7 Anxiety Screening (2 tabs, 11 new rows each)

Section `Depression Screening`, appended **after** `test_requirements_depression_screening_statement`
(the current last row in both tabs). `Field's display priority` continues the section's
existing numbering; `Section key` / `Section Name` / `Display priority` copied from the
sibling rows of that section.

Roles for every new row: `Sale=HIDE, PSS=HIDE, Provider=EDIT`, except the two `content`
rows and the score, which are `Provider=VIEW` — matching the PHQ-2 block.

| # | field_key | Field Type | Label | Values |
|---|---|---|---|---|
| 1 | `test_requirements_content_ANXIETY_SCREENING_gad7` | `content` | `GAD-7 Anxiety Screening` | — |
| 2 | `test_requirements_content_ANXIETY_SCREENING_2` | `content` | `Over the last 2 weeks, how often have you been bothered by any of the following?` | — |
| 3 | `test_requirements_anxiety_screening_nervous_gad7` | `radio` | `1. Feeling nervous, anxious, or on edge` | `Not at all;Several days;More than half the days;Nearly every day` |
| 4 | `test_requirements_anxiety_screening_control_worrying_gad7` | `radio` | `2. Not being able to stop or control worrying` | same |
| 5 | `test_requirements_anxiety_screening_worrying_too_much_gad7` | `radio` | `3. Worrying too much about different things` | same |
| 6 | `test_requirements_anxiety_screening_trouble_relaxing_gad7` | `radio` | `4. Trouble relaxing` | same |
| 7 | `test_requirements_anxiety_screening_restless_gad7` | `radio` | `5. Being so restless that it is hard to sit still` | same |
| 8 | `test_requirements_anxiety_screening_annoyed_gad7` | `radio` | `6. Becoming easily annoyed or irritable` | same |
| 9 | `test_requirements_anxiety_screening_afraid_gad7` | `radio` | `7. Feeling afraid as if something awful might happen` | same |
| 10 | `test_requirements_anxiety_screening_score` | `textfield` | `GAD-7 total score:` | — |
| 11 | `test_requirements_anxiety_screening_score_table` | `content` | `GAD-7 screening result` | — |

All 7 questions: Required = **No**.

### Scoring — labels stored, points mapped in JS

Per the 2026-08-11 rule: `Values` keeps the human-readable labels, **column AD stays empty**
(no per-option `values` override). The map lives in the score field's `calculateValue`, in
column **AE** `customFormIOfield` of row 10:

```json
{
  "calculateValue": "const m = {'Not at all': 0, 'Several days': 1, 'More than half the days': 2, 'Nearly every day': 3}; const keys = ['test_requirements_anxiety_screening_nervous_gad7','test_requirements_anxiety_screening_control_worrying_gad7','test_requirements_anxiety_screening_worrying_too_much_gad7','test_requirements_anxiety_screening_trouble_relaxing_gad7','test_requirements_anxiety_screening_restless_gad7','test_requirements_anxiety_screening_annoyed_gad7','test_requirements_anxiety_screening_afraid_gad7']; let total = 0; for (const k of keys) { total += m[data[k]] || 0; } value = total;"
}
```

This mirrors `sdoh_hits_*`, NOT PHQ-2 (PHQ-2's numeric value override is existing behaviour,
not the pattern for new questionnaires).

### Row 11 `HTML Content` — interpretation table

Copied from the ticket's attachment, same markup style as `sdoh_hits_score_table`:

```html
<table class="table table-bordered">
  <tr><th>Score</th><th>Interpretation</th></tr>
  <tr><td>0-4</td><td>Minimal anxiety</td></tr>
  <tr><td>5-9</td><td>Mild anxiety</td></tr>
  <tr><td>10-14</td><td>Moderate anxiety</td></tr>
  <tr><td>15-21</td><td>Severe anxiety</td></tr>
</table>
```

---

## Change 3 — SDOH intimate-partner-violence gate (`Wellness Lite_HRA` only)

### 3a. Three new rows, inserted **before** `sdoh_content_hits`

| # | field_key | Field Type | Label | Values | Roles |
|---|---|---|---|---|---|
| 1 | `sdoh_content_ipv` | `content` | `Relationship Safety` | — | Provider=VIEW |
| 2 | `sdoh_ipv_physically_hurt_home` | `radio` | `In the last 12 months, have you been hit, slapped or kicked by someone in your home?` | `Yes;No` | Provider=EDIT |
| 3 | `sdoh_ipv_emotionally_disgraced` | `radio` | `Have you been emotionally disgraced or bullied by your partner / roommate?` | `Yes;No` | Provider=EDIT |

Both questions: Required = **No**. `Field's display priority` takes the slot immediately
before `sdoh_content_hits`; rows from `sdoh_content_hits` down shift by 3.

Heading wording `Relationship Safety` is a proposal — the ticket names no heading and the
Figma frame shows the two questions with no heading of their own. Confirm or rename.

### 3b. Conditional display on the 7 existing HITS rows — column **AE** only

`sdoh_content_hits`, `sdoh_hits_physically_hurt`, `sdoh_hits_insult`, `sdoh_hits_threaten`,
`sdoh_hits_scream_curse`, `sdoh_hits_score`, `sdoh_hits_score_table`.

The gate is an OR of two fields, which `conditional {show, when, eq}` in column AD cannot
express, so it goes in AE as `customConditional`:

```json
{"customConditional": "show = data.sdoh_ipv_physically_hurt_home == 'Yes' || data.sdoh_ipv_emotionally_disgraced == 'Yes';"}
```

**AE on these rows is likely already occupied** (`customClass`, `validate`). For each row:
read the existing AE, `json.loads` it, assert `"customConditional" not in old`, merge, write.
Never blind-overwrite.

**`clearOnHide` is NOT set** and hidden values are NOT cleared — the user ruled the
`cleared_keys` work out of scope for US14. Consequence to accept knowingly: answering
`No` after HITS was filled leaves the old HITS answers and score in the case record.

---

## Verification after applying

1. Every touched row: re-read and diff against this spec, cell by cell.
2. Assert column boundary: `"customConditional" not in AD` and AD unchanged on the 7 HITS rows.
3. Assert `json.loads` succeeds on every AE cell written.
4. Assert the GAD-7 rows have **empty AD** (no `values` override).
5. Row counts: `Wellness_HRA` 191 → 202 · `Wellness Lite_HRA` 162 → 176.

## Out of scope — reported, not changed

- `sdoh_content_hits` label: sheet `HITS Screening Tool` vs Figma
  `Hurt, Insult, Threaten, Scream (HITS) Screening Tool`.
- `test_requirements_depression_screening_problem_functioning` label: sheet
  `If any problems were checked, how difficult have they made daily functioning?` vs Figma
  `If problems were checked, difficulty in daily functioning`.
- SDOH `Transportation` block did not appear in the Figma frame's text; not treated as a
  removal without the ticket saying so.
