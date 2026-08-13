# Rule: the Core platform has exactly TWO source repos, and work branches off PROD

Applies to every Core / DNA Insights platform ticket (TLH-*, CORE-*) that touches
application code — the Sample Collection dashboard, case APIs, exports, forms, all of it.

## The only two repos

| Side | Path | Remote | Base branch |
|---|---|---|---|
| FE | `/Users/nhut/Documents/GKIM/SSH-DEV/FE/prod-telehealth-provider-dashboard` | `GKIM-DIGITAL-LTD/telehealth-provider-dashboard` | `tms/prod` (repo default) |
| BE | `/Users/nhut/Documents/GKIM/SSH-DEV/BE/prod-telehealth-platform` | `GKIM-DIGITAL-LTD/telehealth-platform` | `prod-tms` (repo default) |

**Do not read, edit, branch from, or commit in any other checkout of these projects.**
The machine holds several stale clones — `staging-telehealth-provider-dashboard`,
`staging-telehealth-platform`, `SSH-STAGING-*`, `SSH-PROD-*`, `SSH-New-PROD-*`,
`prod-telehealth-platform` aside. They point at the same GitHub remotes but sit on
different branches at different ages. They are fine to *grep for orientation*; they are
not where work happens.

## Always branch from prod

1. `git fetch origin <prod base>` in the repo above.
2. Create the **prod** feature branch first, off the prod base — never off `dev` /
   `tms/dev`, never off a staging branch.
3. Only after the prod branch exists do downstream branches (`staging`, `uat`) get cut
   from it, if the ticket needs them.

Branch names are enforced by a husky `pre-commit` hook on both repos:

```
<type>/(prod|uat|staging)/<kebab-case-description>
hotfix/(prod|uat)/<kebab-case-description>
```

`<type>` ∈ `feat fix chore docs style refactor test build ci perf revert`.
So a prod feature branch reads `feat/prod/tlh-2083-align-sample-collection-columns`.

When pushing, pass the branch explicitly — `git push -u origin <branch>` — because a
branch created with `git checkout -b <name> origin/<base>` tracks the BASE, and a bare
`git push` would target the base branch.

## Why

Prod is the trunk here; `dev` receives prod (see the `chore/auto-sync-prod-to-dev`,
`chore/merge-prod-to-dev` branches on both remotes), not the other way round. A feature
branched off `dev` carries dev-only commits into whatever it merges into and cannot be
promoted to prod cleanly.

## What went wrong on 2026-08-13 (TLH-2083)

Implemented the Sample Collection column change in `staging-telehealth-provider-dashboard`
and `staging-telehealth-platform`, branching off `origin/tms/dev` and `origin/dev`, named
`feat/tlh-2083-…` and `feat/dev/tlh-2083-…`. Both got merged into the dev branches — wrong
repos, wrong base, wrong flow, and the work now has to be redone against prod.

**Rule going forward:** before the first edit of any Core platform ticket, confirm the
working directory is one of the two paths above and the branch is cut from that repo's
prod base. If a task hands over a different path, stop and ask rather than working in it.

## Related

- `.claude/rules/authoring-language.md` — commits, comments and specs in English.
- `.claude/skills/analyze-clickup-task/knowledge/learned-rules.md` — analysis corrections.
