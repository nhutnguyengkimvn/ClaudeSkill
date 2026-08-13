# Rule: write files and commands in English

Everything Claude AUTHORS is in English — no Vietnamese:

- Code comments, docstrings, variable/function names.
- Markdown files: rules, knowledge notes, READMEs, plans, specs, reports.
- Commit messages, branch names, shell commands and their inline comments.
- Log/warning/error strings emitted by tools and scripts.
- Memory files under `~/.claude/projects/<project>/memory/`.

## Not covered — leave as-is

- **Product UI copy that is a translated feature.** DemoPage ships a VI/EN switch;
  the `vi` half of `assets/i18n.js` and the `desc.vi` fields in `assets/demos.js` are
  content, not authoring. Keep them Vietnamese and keep both dictionaries in sync.
- Text the user wrote themselves (their own CLAUDE.md, their sheet data, their tickets).
- Chat replies: keep answering the user in the language they write in.
- **Vietnamese trigger phrases in a skill's `description`** (e.g. `"phân tích task này"`).
  They exist so the skill matches what the user actually types — translating them breaks
  routing. Same for report section headings a skill prints for the user to read.
- **Verbatim quotes of what the user said**, e.g. the decision log in
  `.claude/skills/analyze-clickup-task/knowledge/learned-rules.md`. Quoting is evidence;
  translating a quote loses it. Everything around the quote is still English.

**Why:** the files are read by other Claude sessions, by teammates, and by tooling that
greps them. Mixed-language sources make that unreliable, and a spec handed to another
session should be in the language the model reasons about most predictably.
