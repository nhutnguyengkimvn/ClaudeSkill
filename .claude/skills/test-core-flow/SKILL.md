---
name: test-core-flow
description: >
  Orchestrator for the DNA Insights end-to-end core test flow. Chains the test
  sub-skills in order (create case as SALES → submit case to Pending as PSS),
  asks the environment ONCE up front, and keeps shared run state in
  state/report.json so each sub-skill can consume the previous one's output.
  Invoked as `test-core-flow`. Use the registry below to pick which sub-skill
  handles which job when only part of the flow is needed.
---

# Test — Core Flow (orchestrator)

Runs the DNA Insights core test flow end-to-end by chaining sub-skills. Each
sub-skill is also independently invocable — the registry defines which one to
pick for which job.

## Sub-skill registry

| # | Sub-skill | Account (role) | What it does | Key inputs |
|---|-----------|----------------|--------------|------------|
| 1 | `/test-create-new-case` | SALES (`vu.bui.sales@…`) | Login → Create case wizard → save sections → Submit → case **Draft → New** → logout | `medicare_id` (ask user), env |
| 2 | `/test-submit-case-to-pending` | PSS (`vu.bui.pss@…`) | Login → search & open the case → fill **Compliance** + **Medications** (skip disabled) → case reaches **Pending** (no logout — PSS stays logged in) | `case_id` (from report.json, or ask if standalone), env |
| 3 | `/test-provider-call-flow` | PSS + PROVIDER (`vu.bui.provider@…`, dual browser contexts) | PSS calls patient (804-222-1111) + rings provider → provider answers, opens case, completes clinical sections + Orders + Care Plan + Diagnosis → waits for Master Encounter Report | `case_id` (from report.json, or ask if standalone), env |

More sub-skills will be appended here as the flow grows (e.g. provider
consult, result delivery). When the user asks for a specific step only, invoke
that sub-skill directly instead of the whole flow.

## Shared state — `state/report.json`

Path: `.claude/skills/test-core-flow/state/report.json` (relative to repo root).

- The orchestrator **initializes/overwrites** it at the start of a core-flow
  run. Sub-skills **merge** their results into `steps.<skill-name>` when they
  finish (whether run from the core flow or standalone).
- Written with the Write/Edit tools by Claude (browser scripts cannot touch
  the filesystem).

```json
{
  "flow": "test-core-flow",
  "environment": "dev",
  "dashboard_url": "https://dev-dashboard.dnainsights.ai/#/",
  "started_at": "<ISO timestamp>",
  "steps": {
    "test-create-new-case": {
      "status": "done",
      "environment": "dev",
      "case_id": "CA-XXXXXXXX",
      "patient_id": "PT-XXXXXXXX",
      "medicare_id": "XXXXXXXXXXX",
      "patient": "Gkim test",
      "sections": { "patient_information": "saved", "opt_in_consent": "saved (No)", "primary_care_provider": "saved", "family_history": "skipped (locked)" },
      "case_status": "New",
      "screenshot": "case-submitted-fast-run.jpeg",
      "finished_at": "<ISO timestamp>"
    },
    "test-submit-case-to-pending": { "…": "…" }
  }
}
```

## Cross-skill landmine — stuck "Loading… ⟳" section body

Applies to EVERY sub-skill (same dashboard): a case section's heading renders
before its form body mounts, and the body can hang on `Loading... ⟳`
indefinitely. Waiting longer never resolves it — every input-level poll reads an
EMPTY form, so the run aborts with a misleading message ("answers did not take
effect", "radio never took the value", `got: []`).

**Rule: body still "Loading…" after ~2s → click ANOTHER section, wait ~1s, click
back.** The remount loads instantly. Encoded as `openSection()` / `clickSection()`
in `fast-02`, `pss-02` and `prov-02` (3 bounce attempts, then a clear
`body stuck on "Loading…"` error). Never "fix" this by raising timeouts.

## Environment rule (IMPORTANT)

- **From `/test-core-flow`**: the orchestrator asks the environment ONCE
  (Phase 0) and stores it in `state/report.json`. Sub-skills invoked by the
  flow MUST NOT ask the environment again — they read it from the report.
- **Standalone**: a sub-skill invoked on its own asks dev/prod itself, then
  still merges its results into `state/report.json`.

## Flow

### Phase 0 — One question round

Ask in a SINGLE `AskUserQuestion` call (two questions):
1. Environment: **dev** (`https://dev-dashboard.dnainsights.ai/#/`) or
   **prod** (`https://dashboard.dnainsights.ai/#/`).
2. The patient's `medicare_id` (goes into Primary Policy # — needed by step 1).

### Phase 1 — Init report

Write `state/report.json` with `flow`, `environment`, `dashboard_url`,
`started_at`, empty `steps`.

### Phase 2 — Run `/test-create-new-case`

Follow that skill's FAST MODE, skipping its environment question (use the
report values). On success it merges its result block into
`steps["test-create-new-case"]`. On failure: stop the flow, report which step
and why.

### Phase 3 — Run `/test-submit-case-to-pending`

Follow that skill's FAST MODE, skipping its environment AND case questions —
`case_id` comes from `steps["test-create-new-case"].case_id`. On success it
merges into `steps["test-submit-case-to-pending"]`.

### Phase 3.5 — Run `/test-provider-call-flow`

Follow that skill's flow, skipping its environment AND case questions —
`case_id` comes from the report (case must be **Pending**). Requires the
patient phone to be 804-222-1111 (set in case-data.json). On success it
merges into `steps["test-provider-call-flow"]`.

### Resume rule

If a core-flow run failed mid-way, `state/report.json` keeps the partial
state. On the next `/test-core-flow` invocation, check it first: when
`steps["test-create-new-case"].status == "done"` and the user confirms they
want to continue that run (offer via `AskUserQuestion`), skip Phase 2 and go
straight to Phase 3 with the recorded `case_id` — do NOT create a duplicate
case. Starting fresh overwrites the file.

### Phase 4 — Final combined report

```
✅ test-core-flow done
   Environment: <dev|prod>
   1) create-new-case:        CA-… / PT-… — Draft → New ✅
   2) submit-case-to-pending: Compliance ✅ / Medications ✅ — New → Pending ✅
   Report: .claude/skills/test-core-flow/state/report.json
```

List any unresolved questions at the end, if any.
