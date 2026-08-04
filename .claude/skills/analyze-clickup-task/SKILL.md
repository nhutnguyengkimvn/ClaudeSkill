---
name: analyze-clickup-task
description: >
  Analyzes a ClickUp task (screenshot, pasted task doc, or plain description) and
  produces a concrete plan of attack for the Core platform: what the task is
  actually asking for, which charting template and which sheet tab it lands in,
  which existing field keys it touches, and what has to change per field. Reads
  the Core field-mapping Google Sheet directly so field keys are looked up, not
  guessed. Use whenever the user says "phân tích task này", "/analyze-clickup-task",
  pastes a ClickUp user story / Scope block, or drops a screenshot of a ticket and
  asks how to approach it. Output is an analysis and a proposal — it does NOT
  implement anything. Invoked as `analyze-clickup-task [task text | screenshot path]`.
---

# Analyze a ClickUp task → plan of attack

Turns a ticket into: *which template, which tab, which field keys, what changes,
what is still unknown.* It stops at the proposal — implementation is a separate,
explicit ask.

This skill is meant to be **trained**. Every correction the user gives goes into
`knowledge/learned-rules.md` as a rule before the turn ends; durable facts about
the platform go into `knowledge/core-platform-map.md`. Read both at the start of
every run.

## Inputs

- A screenshot → read it with the Read tool. Multiple screenshots = one task.
- Pasted task text (User Story / Overview / Scope) → use verbatim.
- A one-line verbal description → still run the flow, but expect step 5 to have
  more open questions.

Never fill a gap in the ticket by assumption. Unstated behaviour is an open
question, not a decision the analysis gets to make.

## The sheet

Core's form fields are defined in a link-readable Google Sheet:

<https://docs.google.com/spreadsheets/d/1_k-lFKB_68XGGr7PIpsM_wkOX3boscCFrsA6aawT374>

Query it — do not open it by hand and do not eyeball a screenshot of it:

```bash
S=.claude/skills/analyze-clickup-task/scripts/core-sheet.py
python3 $S --tabs                                  # tab → gid
python3 $S --sections Wellness_HRA                 # sections in a tab + field counts
python3 $S --find "assistive|fall" --tab Wellness_HRA
python3 $S --section "General Health" --tab Wellness_HRA
python3 $S --find "hospitaliz"                     # all 38 tabs
```

Rows print as `[tab] [section] field_key type=… ` plus label, values, role config,
`Related Fields`, `CONDITIONAL VALUE`, `JSON`. CSVs cache under
`/tmp/core-sheet-cache` — delete it to force a refresh when the sheet has changed.

## Flow

### 1. Restate the task as a scope tree

Before any lookup, reduce the ticket to a tree the user can check at a glance:

```
<Section>
  <Field / control>  → <required change>
```

Keep the ticket's own wording for section, label and placeholder text — those
strings are deliverables, not paraphrase. Separately list any **non-form**
deliverable the ticket mentions (Progress Note, document template, report).

### 2. Decide the target template(s)

`Wellness` · `Wellness Lite` · both · a lab requisition form. "both Wellness and
Wellness Lite" is common and doubles every tab in step 3. If the ticket never
says, ask — it changes the whole worklist.

### 3. Route each section to its tab

From `knowledge/core-platform-map.md`. The split that catches people out: chart
sections live in `Wellness` / `Wellness Lite`, but **General Health, Functional
Status & Safety, Social History, Depression Screening, Advance Care Planning,
Preventive Screening, Medications, Master Encounter Report, Test Requirements
live in `Wellness_HRA` / `Wellness Lite_HRA`**. Verify with `--sections`; if a
section is missing where expected, `--find` across all tabs before calling it new.

### 4. Match every task item to the nearest existing field key

For each leaf of the scope tree, run `--find` on the distinctive words of its
label and classify:

| Verdict | Meaning | What to report |
|---|---|---|
| **exact** | a row whose Label is the ticket's field | key, current `Field Type`, current `Values`, role config |
| **near** | same subject, different label/wording | the key + why it is the match + what differs |
| **new** | nothing in any tab covers it | the key you propose, derived from the sibling convention |

Propose new keys from the observed convention, never freehand: a field that
appears when a Yes/No parent is `Yes` is `<parent_key>_yes`; an "Other" free-text
is `<parent_key>_other`. Cite the sibling row you copied the pattern from.

### 5. Write the analysis

Sections, in this order:

1. **Task nói gì** — the scope tree from step 1, plus template + tabs.
2. **Field mapping** — one table row per task item: section · task field · matched
   `field_key` · verdict · current state · proposed change.
3. **Đề xuất cách làm** — the ordered worklist. Group by tab, because that is the
   unit of work. Include the non-form deliverables as their own items.
4. **Cần bạn xác nhận** — every open question, each with the options you see and
   your recommendation. Anything that does not fit the known model belongs here —
   flag it, propose the closest fit, and do **not** invent new vocabulary,
   conventions or schema values to make it fit.

Keep it short enough to read in one pass. A table beats prose.

### 6. Close the training loop

End by asking the user to correct anything wrong. When they do, append the rule
to `knowledge/learned-rules.md` (and new platform facts to
`core-platform-map.md`) **in the same turn** — before doing anything else with
the correction. A correction that only fixes the current report is a correction
lost.

## Boundaries

- Analysis only. No sheet edits, no Form.io edits, no code. If the user wants
  implementation, that is a new instruction — and for Form.io schema work the
  `create-formio` / `clone-form-io` / `verify-formio-panel-params` skills already
  exist.
- Do not state a conditional-display mechanism as fact: see open question 1 in
  `core-platform-map.md`. Describe the intended condition in prose and mark how
  it is declared as unconfirmed.
- Field keys, labels and placeholder strings are quoted exactly or not at all.
