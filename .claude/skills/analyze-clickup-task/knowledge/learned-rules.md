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

## 2026-08-11 — Sub-ticket (USxx.y) beats its parent (USxx) on conflict

**Was:** flagged US12 "remove Preventive Screening entirely" vs US12.1 "add
Preventive Screening" as an unresolved contradiction needing PO sign-off.
**Correct:** user: *"US12.1 là mới nhất tin vào nó nha."*
**Rule going forward:** when a child page contradicts its parent, the child (the
newer, more specific one) wins. Still *state* the conflict in one line so it is
visible, but resolve it in the child's favour and keep going — do not block.

## 2026-08-11 — Reuse the existing field_key, don't coin a parallel one

**Was:** proposed new `sdoh_food_*` / `sdoh_transportation_*` keys for questions
that already have keys in `Wellness_HRA` but not in the target tab.
**Correct:** user: *"giữ nguyên cũ"* — reuse `health_behaviors_food_worry`,
`health_behaviors_food_run_out`,
`functional_safety_screening_transportation_barrier`,
`functional_safety_screening_feel_utility_problems` even though they now sit
under a different `Section key`.
**Rule going forward:** if a question already owns a `field_key` anywhere in the
Wellness family, reuse that key verbatim when the question moves tabs or
sections. Only genuinely new questions get a new key. A key whose prefix no
longer matches its section is acceptable and expected — the key is the identity,
the section is just placement.

## 2026-08-11 — Copying a section = copy it verbatim, rename only the label

**Was:** asked whether to copy all 5 rows of a section and which of the three
observed section names to use.
**Correct:** user: *"copy y chang bỏ vào"*, and rename the display name to the
ticket's string while keeping every `field_key` unchanged.
**Rule going forward:** "copy section X to template Y" means: same `field_key`s,
same `Field Type`s, same role config, same `Field's display priority` order,
same `JSON` / `HTML Content` / `customFormIOfield` payloads. Only `Section Name`
changes, to whatever the ticket writes. Do not re-key on copy.

## 2026-08-11 — Scored questionnaires: map labels in JS, don't override option values

**Was:** gave the 4 HITS radios a `additional_component_props JSON` `values`
array (`Never`→"1" … `Frequently`→"5"), copying how PHQ-2 declares 0–3, so the
form would store the number.
**Correct:** user: *"mấy value vẫn lưu là Never;Rarely;… nhưng mà phần score sẽ
có 1 cái mapping bằng js sẽ map điểm trong đó."* Leave `Values` as the label
list, write nothing into `additional_component_props JSON`, and put the
label→score map inside the score field's `customFormIOfield.calculateValue`:
`const m = {'Never': 1, ...}; ... value += m[x[i]] || 0;`
**Rule going forward:** for a NEW scored questionnaire, default to storing the
human-readable label and mapping to points in the score field's JS. The stored
answer stays readable downstream (MER, Progress Note); a numeric override makes
the saved data opaque. PHQ-2's value-override is existing behaviour, not the
pattern to copy into new work. Only override option values when the user asks.

## 2026-08-11 — Scope text wins over Figma for *whether* a field exists

**Was:** treated everything visible in the Figma design as in-scope, including a
dropdown and a required-marker the ticket's Scope never mentioned.
**Correct:** user, twice: *"section C ko đụng thì bỏ qua đi có thể design nhầm"*
and *"trong docs ko nhắc thì bỏ qua luôn nha"*.
**Rule going forward:** the ticket's Scope decides **which fields exist**; the
design decides **how the ones in Scope look and behave** (order, layout, labels,
required markers on fields Scope already lists, placeholder text). A control that
appears only in the design is out of scope by default — report it as a finding,
do not add it. Exception worth surfacing rather than deciding: when the design
shows that control filled with content clearly authored for it (not sample data
copied from a sibling block), say so and ask, because that is evidence of intent
rather than a drafting slip.

## 2026-08-11 — Read the whole component before reporting a field missing

**Was:** reported that the care-plan datagrid had no goal field, and proposed
adding `plan_goal`. The walker script had thrown midway through
`components/4.json` and only printed the first 4 of 7 sub-components.
**Correct:** the component already has `care_goals` (textarea) — the user proved
it with a screenshot of the live Add Care Plan modal.
**Rule going forward:** never report "field X does not exist" from a traversal
that errored. Check the child count against what was printed, and prefer a flat
`len(components)` + key dump over a recursive walk. A false "missing field"
manufactures work that doesn't exist.

## 2026-08-11 — Section placement is the `Display priority` column

**Was:** described section position in prose ("chèn giữa A và B").
**Correct:** placement is a number — the `Display priority` column, shared by
every row of a section. `Wellness Lite_HRA` today:
`opt_in_consent`=2 · `medication`=6 · `test_requirements`=8 · `general_health`=10
· `screening_questionnaire_depression`=11 · `social_history_screening`=12
· `advance_care_planning`=16 · `mer`=22.
**Rule going forward:** when a ticket says "position after <section>", resolve it
to a concrete `Display priority` integer and check whether a free slot exists. If
not, state the renumber explicitly (which existing sections shift, and to what)
instead of leaving it as prose. Note the trap: in the HRA tabs Depression
Screening (11) comes **before** Social History (12), which is not the order the
section list prints in.

## 2026-08-12 — `append_logic` / `clearOnHide` go in **AE**, never in AD

**Was:** asked to add an `append_logic` required-toggle + `clearOnHide` to 7
Social History fields across `Wellness_HRA` + `Wellness Lite_HRA`, and wrote the
whole payload — `clearOnHide` + `append_logic` + `conditional` — into one cell in
**AD** (`additional_component_props JSON`). All 14 cells verified "correct" and
were still wrong: wrong column.
**Correct:** user: *"phần append phải nằm bên cột AE."* The split is per-column,
not per-field:
- **AD** = `additional_component_props JSON` (col **30**) → static props only:
  `conditional {show, when, eq}`, per-option `values`, `customClass`.
- **AE** = `customFormIOfield` (col **31**) → the behavioural hooks:
  `append_logic`, `clearOnHide`, `customConditional`, `calculateValue`,
  `recalculateOn`, `validate`, `defaultValue`, `tooltip`.
The reference row is `social_history_screening_summary_statement`
(`Wellness_HRA` row 46 / Lite row 23): AD keeps `conditional`, AE holds
`clearOnHide` + `append_logic` + `calculateValue`. `..._alcohol_score` (HRA 43)
is the same split with a *Hidden* action instead of *Required*.
**Rule going forward:**
1. Before writing a cell, decide the column from the PROPERTY, not from where a
   similar value happens to sit: any `append_logic` / `clearOnHide` /
   `customConditional` / `calculateValue` → AE. `conditional` / `values` → AD.
2. **AE is usually already occupied** — 10 of those 14 rows held
   `{"customClass": "formio-column-50"}`, two also `"validate": {"min":1,"max":50}`.
   Read the existing AE JSON, `json.loads` it, MERGE the new keys in (existing
   props first), and assert `"append_logic" not in old` before writing. Never
   blind-overwrite AE.
3. When a task says "delete the data in column AD", that is a statement about
   **AD only** — it does not license moving that field's show/hide logic away.
   Ask where `conditional` should live if the answer is not obvious.
4. Verification must check the COLUMN, not just JSON validity: assert
   `set(AD) == {"conditional"}` and `"append_logic" not in AD`. A "14/14 OK"
   report that never asserted the column boundary is what let this slip through.

## 2026-08-12 — Hidden field + PATCH-merge BE = stale data; clear with an empty value, not `clearOnHide`

**Was:** gated fields carried `clearOnHide: true`. User's bug: with
`social_history_screening_alcohol = No` the dependent
`..._alcohol_counseling_exclusive_duration` is hidden, `clearOnHide` **deletes the
key from the payload**, the BE merges (absent key = ignore), so the old value
stays in the DB. For a billing field (5–15 min rule) that is a wrong claim.
**Correct:** user chose the sheet-only fix — keep the key in the payload and send
it EMPTY, so the BE overwrites:
```json
"clearOnHide": false,
"allowCalculateOverride": true,
"recalculateOn": "<gate_key>",
"calculateValue": "value = data.<gate_key> == 'Yes' ? (data.<own_key> ?? '') : '';"
```
**Rule going forward:**
1. `clearOnHide: true` is the platform's "Clear Value" action — it drops the key.
   Only use it when the BE treats an absent key as "clear". With a merge/PATCH BE
   it silently preserves stale data.
2. **`calculateValue` is the wrong tool here — TESTED AND FAILED on 2026-08-12.**
   Config reached the compiled component correctly (verified in the live form
   JSON) and it still pushed the stale value. `allowCalculateOverride: true`
   compares the CURRENT dataValue against the PREVIOUS run's `calculatedValue`,
   so the moment the provider types a number the two differ, Form.io concludes
   "user overrode this" and disables the calculation for the rest of the form's
   life — including the gate-off run that was supposed to clear it. A
   self-referential calc does NOT dodge this (an earlier note here claimed it
   did; that was wrong — the comparison spans two runs, and typing happens in
   between). Use a logic **Set Value** arm instead:
   ```json
   {"name":"clearWhenNo<Tag>",
    "trigger":{"type":"javascript","javascript":"result = data.<gate_key> != 'Yes';"},
    "actions":[{"name":"clearValue<Tag>","type":"value","value":"value = '';"}]}
   ```
   Logic arms run for hidden components too (logic is what sets `hidden` in the
   first place), and they are not subject to override detection.
3. Never remove `clearOnHide` without adding the empty-set calc in the same edit:
   a hidden field with `clearOnHide: false` and no calc pushes its STALE value,
   which is worse than the original bug.
4. This bug class hits every conditional field in the HRA tabs (topics_discussed,
   counseling_notes, secondhand_smoke_yes, smoke_yes/_years, drugs_yes …). The
   per-field fix above is a treadmill; the systemic fix is FE sending a
   `cleared_keys` list of hidden component keys for the BE to null. Raise that
   when the count of patched fields keeps growing.

## 2026-08-12 — Outcome: the sheet cannot fix the stale-data bug; FE+BE `cleared_keys` won

**Was:** two sheet-only attempts at clearing a hidden dependent field —
(a) `clearOnHide: false` + `calculateValue`, (b) the same plus a logic **Set
Value** arm. Attempt (a) was verified in the compiled component and still pushed
the stale value (`allowCalculateOverride` override-detection kills the calc once
the user types).
**Correct:** user's decision — *"tui đi theo hướng FE push clear.. lên BE sẽ remove
nó ra"*: FE sends the cleared/hidden keys, BE removes them. The 14 AE cells were
reverted to the plain `clearOnHide: true` + required/requiredlabel state.
**Rule going forward:** when a fix requires the *submission payload* to carry
information Form.io does not natively send (an explicit "this was cleared"
signal), it is a FE/BE change, not a sheet change. Do not burn rounds patching
`customFormIOfield` for it. The sheet governs a component's shape and behaviour;
it cannot change what the app serialises or how the BE merges. Recognise this
class early: symptom = "field is hidden, BE keeps old value".

## 2026-08-12 — `__json__` rows: empty N/O columns are not a data gap

**Was:** user asked why section `preventive_care` (Lite tab) rendered only 2 fields. I
answered that `preventive_past_exam` / `preventive_past_immunization` were **"missing Field
Type in the sheet"** and told the user to go fill the column in — i.e. I called it a data bug.
**Correct:** wrong. Both rows have **column A = `__json__`** and **column V = a Firebase
URL**; the component definition lives at that URL (both are `datagrid`s with children and
`defaultValue` rows). Leaving `Field Type`/`field_key` blank is **by design**.
**Rule going forward:**
1. Before calling a row "missing type/key", **read column A and column V**. `A == '__json__'`
   → fetch the JSON from column V, do not report a data gap.
2. Any tool that builds a form from the sheet must: fetch the URL → use it as the base →
   **merge AD then AE on top** → append `append_logic` to `logic`. Label/type/key: the
   sheet's value wins when present, otherwise the JSON's.
3. When reporting "n rows skipped", state the **reason per row** (genuinely missing type/key
   vs a `__json__` URL that failed to load). A bare count tells the user nothing — that is
   why the user had to open the sheet and check by hand.
4. The Firebase endpoint allows CORS (`access-control-allow-origin: *`) → use `fetch()`; only
   Google Sheets gviz needs JSONP. See [[core-sheet-ad-ae-columns]].

## 2026-08-13 — Never edit the sheet on my own; plan must be approved first

**Was:** on 2026-08-12 I edited 14 cells of the sheet (column AD then AE, across four
passes: v2 → v3 → v4 → revert) right after the user described the requirement, without
presenting a plan for approval.
**Correct:** user: *"note trong file .MD rules không được tự động chỉnh sheet. phải có plan
tui ok xong mới đc chỉnh."*
**Rule going forward:** see `.claude/rules/sheet-edit-policy.md` — no automated cell
writes; a plan (tab / section / field_key / column / old → new) must be approved first; the
default deliverable is a **spec for the user or another Claude session to apply**, and I only
write to the sheet when the user says so explicitly in the same turn.

## 2026-08-13 — Author files and commands in English

**Was:** rules, knowledge entries, code comments, tool output strings and memory files were
written in Vietnamese.
**Correct:** user: *"mấy file ghi hay command đều là English nha"*.
**Rule going forward:** see `.claude/rules/authoring-language.md`. Everything authored —
comments, markdown, commit messages, commands, log/error strings, memory files — is English.
Product UI copy that is a translated feature (the `vi` dictionary in DemoPage's
`assets/i18n.js`, `desc.vi` in `assets/demos.js`) stays Vietnamese, and chat replies stay in
the user's language.
