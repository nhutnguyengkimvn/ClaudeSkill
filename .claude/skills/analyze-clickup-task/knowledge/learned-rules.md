# Learned rules

Corrections and confirmations from the user, newest last. This file is the whole
point of the skill improving over time: every time an analysis is wrong, the fix
lands here as a rule, not as a one-off patch to a report.

Format — keep each entry to what changes future behaviour:

```
## <date> — <short title>
**Was:** what the analysis assumed or produced.
**Correct:** what the user said is actually true.
**Rule going forward:** the generalised instruction.
```

---

## 2026-08-04 — Section→tab routing

**Was:** looked for "General Health" and "Functional Status & Safety" in the
`Wellness` tab and found nothing.
**Correct:** those sections live in `Wellness_HRA` / `Wellness Lite_HRA`. The
`Wellness` tab holds the chart sections (Compliance … Diagnosis, RPM).
**Rule going forward:** resolve section → tab from
`knowledge/core-platform-map.md` before searching; when a section is missing from
the expected tab, search all tabs with `--find` before concluding it is new.

## 2026-08-04 — Read the `Field Type` vocabulary before proposing a type

**Was:** proposed `radio` → `selectboxes` for "make it multiple checkbox", and
described the show/hide condition as prose because `CONDITIONAL VALUE` was empty.
**Correct:** the platform has a declarative trigger vocabulary —
`radioshowother`, `selectboxshowother`, `checkboxshowothers`,
`checkboxhideothers`, `radiosetvalue` — paired with the `Related Fields` column.
`selectboxshowother` is the better fit for a multi-select with an `Other`
free-text. But those types appear **only in the chart tabs**, not in `_HRA`.
**Rule going forward:** before proposing any `Field Type`, dump the distinct
types actually in use **in the target tab**, and check `Related Fields` on a
sibling for the wiring. Never assume a type is available in a tab that has no row
using it — that goes in "Cần bạn xác nhận".

## 2026-08-04 — Do not invent vocabulary to fit an odd case

**Was:** (from the sibling `extract-recform-panels-csv` work) added new enum
values to a data contract to accommodate two unusual rows.
**Correct:** user wants odd cases mapped to the nearest existing concept and
**flagged for confirmation**, not new vocabulary invented mid-run.
**Rule going forward:** in an analysis, when something does not fit the known
model, say so in the "Cần bạn xác nhận" section and propose the closest fit.
Never quietly extend a schema, key convention, or enum.
