# Error Handling

## Global Rules

- **Never stop the whole process because of one file failure** — except input
  validation (see below), which stops before any processing begins.
- Always report what went wrong with enough detail to fix manually
- Mark failed files with ❌ in final report

## Error Cases

| Situation | Action |
|-----------|--------|
| No PDF path supplied | **STOP immediately.** Report `❌ No PDF path supplied. Usage: import-lab-recform <path1.pdf> [<path2.pdf> ...]` |
| A supplied path is missing or not a `.pdf` | **STOP before processing.** Report each invalid path: `❌ Invalid path: <path> (not found / not a PDF)` |
| Cannot detect Test Type/Lab from content (no text / unknown title) | Fall back to reading the PDF directly with Claude's `Read` tool (renders visually). Still unclear → show hints, ask user to confirm Test Type + Lab. If user can't → mark ⚠️, skip, continue |
| Medical Specialty creation fails (save error) | Mark ❌, skip entire cycle for this PDF, continue to next |
| Medical Specific dropdown has no "2026" option | Mark ❌, skip entire cycle, continue |
| 500 error on ReqForm save (short Name) | Retry: change Name → full Description. If still 500 → mark ❌, skip |
| Sync CSV message not shown | Report `⚠️ Sync CSV may not have triggered`, continue anyway |
| sejda.com fails to process PDF | Retry once. Still fails → skip Section 2, mark ❌ S2 |
| ReqForm dropdown can't find Description in S2 | Mark ❌ S2, continue to next PDF |
| Google Sheet tab not found and clone fails | Report ⚠️, ask user to create tab manually, skip gid step |
| Form.io JSON invalid / editor rejects paste (W04) | Fix JSON (Format/Repair button), re-paste. Do NOT Save invalid JSON |
| Target `[ENV] [AI] order services …` form already exists (W04) | Ask user: edit existing or skip. Don't overwrite blindly |
| User not satisfied with generated form (W04) | Revise JSON per feedback, re-paste, ask again. Never Save without approval. Mark `S3 ⏸` if deferred |

## Reporting Format

```
✅ filename.pdf → S0 skipped | S1 ✅ | Sync ✅ | S2 ✅
✅ filename.pdf → S0 ✅ (created X-2026) | S1 ✅ | Sync ✅ | S2 ✅
❌ filename.pdf → Failed at S0 (Medical Specialty save error)
❌ filename.pdf → Failed at S1 (no 2026 option in Medical Specific)
⚠️ filename.pdf → S1 ✅ | Sync ⚠️ | S2 ✅ (sync message not confirmed)
```
