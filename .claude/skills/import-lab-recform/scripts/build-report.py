#!/usr/bin/env python3
"""Build a self-contained per-recform HTML report from a JSON manifest.

Usage:
    build-report.py <manifest.json>

Writes report-<slug>.html next to the manifest (i.e. inside <recform-slug>/).
All asset paths are relative (./screenshots/<file>.png) so the folder is
portable as a unit. Screenshots are click-to-enlarge via a pure-CSS lightbox
(no JS), so the report renders offline.

Manifest schema:
{
  "recform_name": "PGX - Amedix 2026",
  "slug": "pgx-amedix-2026",
  "mss": "Genetic 2026",
  "test_type": "PGX",
  "lab": "Amedix",
  "source_pdf": "/path/to/source.pdf",
  "dashboard_url": "https://dev-dashboard.dnainsights.ai",
  "timestamp": "2026-06-15 09:54 (GMT+7)",   // optional; auto-filled if omitted
  "steps": [
    {
      "n": 1,
      "title": "Create Medical Specialty",
      "done": "Pre-check found PGX 2026; skipped creation.",
      "outcome": "skipped",                   // success | changes-confirmed | skipped | failed | tbc
      "screenshots": ["01-specialty.png"],    // file names inside ./screenshots/
      "note": "",                             // optional
      "decisions": [                          // optional; one per confirmation gate in this step
        {
          "question": "Which Short Code?",    // what the user was asked
          "options": ["METABOLIC", "META"],   // optional; choices offered
          "recommended": "METABOLIC",         // what the skill proposed / recommended
          "chosen": "METABOLIC",              // what the user actually picked
          "note": ""                          // optional rationale
        }
      ]
    }
  ]
}

Any step that involved an AskUserQuestion / confirmation gate SHOULD carry a
`decisions[]` entry recording both the proposed/recommended option and the
user's choice, so the report is an audit trail of every decision.
"""
import html
import json
import sys


OUTCOMES = {
    "success": ("✅ Success", "#1a7f37", "#dafbe1"),
    "changes-confirmed": ("✔️ Changes confirmed", "#0969da", "#ddf4ff"),
    "skipped": ("⏭️ Skipped", "#6e7781", "#eaeef2"),
    "failed": ("❌ Failed", "#cf222e", "#ffebe9"),
    "tbc": ("⏸️ TBC / Blocked", "#9a6700", "#fff8c5"),
}


def _now_gmt7():
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime(
            "%Y-%m-%d %H:%M (GMT+7)")
    except Exception:
        return ""


def esc(s):
    return html.escape(str(s if s is not None else ""))


def badge(outcome):
    label, fg, bg = OUTCOMES.get(outcome, (esc(outcome), "#6e7781", "#eaeef2"))
    return (f'<span class="badge" style="color:{fg};background:{bg}">'
            f'{esc(label)}</span>')


def render_decisions(decisions):
    """Render confirmation gates: what was proposed/recommended vs what the user chose."""
    if not decisions:
        return ""
    blocks = []
    for d in decisions:
        q = esc(d.get("question", ""))
        recommended = d.get("recommended", "")
        chosen = d.get("chosen", "")
        opts = d.get("options", []) or []
        dnote = d.get("note", "")
        opts_html = ""
        if opts:
            lis = []
            for o in opts:
                tags = []
                if recommended and o == recommended:
                    tags.append('<span class="tag rec">recommended</span>')
                if chosen and o == chosen:
                    tags.append('<span class="tag chosen">✓ chosen</span>')
                lis.append(f"<li>{esc(o)} {' '.join(tags)}</li>")
            opts_html = f'<tr><th>Options</th><td><ul class="opts">{"".join(lis)}</ul></td></tr>'
        rec_html = (f'<tr><th>Proposed / recommended</th><td>{esc(recommended)}</td></tr>'
                    if recommended else "")
        chosen_html = (f'<tr><th>User chose</th><td><strong>{esc(chosen)}</strong></td></tr>'
                       if chosen else "")
        dnote_html = f'<p class="note">{esc(dnote)}</p>' if dnote else ""
        blocks.append(f'''
        <div class="decision">
          <div class="decision-q">❓ {q}</div>
          <table class="dtab">{opts_html}{rec_html}{chosen_html}</table>
          {dnote_html}
        </div>''')
    return '<div class="decisions">' + "".join(blocks) + "</div>"


def render_step(step):
    n = step.get("n", "?")
    title = esc(step.get("title", ""))
    done = esc(step.get("done", ""))
    note = step.get("note", "")
    decisions_html = render_decisions(step.get("decisions", []))
    shots = step.get("screenshots", []) or []
    thumbs = []
    for shot in shots:
        sid = f"img-{n}-{esc(shot).replace('.', '-')}"
        rel = f"./screenshots/{esc(shot)}"
        thumbs.append(f'''
          <a class="thumb" href="#{sid}"><img src="{rel}" alt="{esc(shot)}" loading="lazy"></a>
          <a class="lightbox" id="{sid}" href="#close-{n}">
            <img src="{rel}" alt="{esc(shot)}">
          </a>''')
    thumbs_html = ('<div class="shots">' + "".join(thumbs) + "</div>"
                   if thumbs else '<p class="muted">No screenshot.</p>')
    note_html = f'<p class="note">{esc(note)}</p>' if note else ""
    return f'''
      <section class="step" id="step-{n}">
        <h3><span class="num">{n}</span> {title} {badge(step.get("outcome", ""))}</h3>
        <p>{done}</p>
        {note_html}
        {decisions_html}
        {thumbs_html}
      </section>'''


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: build-report.py <manifest.json>")
    manifest_path = sys.argv[1]
    with open(manifest_path) as f:
        m = json.load(f)

    steps = m.get("steps", [])
    ts = m.get("timestamp") or _now_gmt7()
    n_total = len(steps)
    n_ok = sum(1 for s in steps if s.get("outcome") in ("success", "changes-confirmed"))
    n_confirm = sum(1 for s in steps if s.get("outcome") == "changes-confirmed")
    tbc = [s for s in steps if s.get("outcome") in ("tbc", "failed")]

    tbc_html = ""
    if tbc:
        items = "".join(f"<li>Step {esc(s.get('n'))}: {esc(s.get('title'))} "
                        f"— {esc(s.get('note') or s.get('outcome'))}</li>" for s in tbc)
        tbc_html = f'<div class="tbc"><strong>TBC / Blocked:</strong><ul>{items}</ul></div>'

    meta_rows = "".join(
        f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in [
            ("Recform", m.get("recform_name")),
            ("MSS", m.get("mss")),
            ("Test Type", m.get("test_type")),
            ("Lab", m.get("lab")),
            ("Source PDF", m.get("source_pdf")),
            ("Dashboard", m.get("dashboard_url")),
            ("Run at", ts),
        ] if v)

    steps_html = "".join(render_step(s) for s in steps)

    doc = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report — {esc(m.get("recform_name", "recform"))}</title>
<style>
  body{{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328;max-width:920px;margin:0 auto;padding:24px}}
  h1{{font-size:22px;margin:0 0 4px}}
  .sub{{color:#6e7781;margin:0 0 20px}}
  table.meta{{border-collapse:collapse;width:100%;margin-bottom:20px}}
  table.meta th{{text-align:left;width:140px;color:#6e7781;font-weight:600;padding:4px 8px;vertical-align:top}}
  table.meta td{{padding:4px 8px;word-break:break-all}}
  .summary{{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}}
  .card{{background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px}}
  .card .big{{font-size:24px;font-weight:700}}
  .card .lbl{{font-size:12px;color:#6e7781}}
  .tbc{{background:#fff8c5;border:1px solid #d4a72c;border-radius:8px;padding:10px 16px;margin-bottom:20px}}
  .tbc ul{{margin:6px 0 0;padding-left:20px}}
  .step{{border:1px solid #d0d7de;border-radius:8px;padding:14px 18px;margin-bottom:16px}}
  .step h3{{margin:0 0 8px;font-size:17px;display:flex;align-items:center;gap:8px}}
  .num{{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#0969da;color:#fff;font-size:14px;flex:none}}
  .badge{{font-size:12px;font-weight:600;padding:2px 8px;border-radius:12px;margin-left:auto}}
  .muted{{color:#6e7781;font-style:italic}}
  .note{{color:#6e7781;font-size:13px}}
  .decisions{{margin:10px 0}}
  .decision{{background:#ddf4ff;border:1px solid #54aeff;border-radius:8px;padding:10px 14px;margin:8px 0}}
  .decision-q{{font-weight:600;margin-bottom:6px}}
  table.dtab{{border-collapse:collapse;width:100%}}
  table.dtab th{{text-align:left;width:180px;color:#0969da;font-weight:600;padding:3px 8px;vertical-align:top}}
  table.dtab td{{padding:3px 8px}}
  ul.opts{{margin:0;padding-left:18px}}
  .tag{{font-size:11px;font-weight:600;padding:1px 6px;border-radius:10px;margin-left:4px}}
  .tag.rec{{background:#fff8c5;color:#9a6700}}
  .tag.chosen{{background:#dafbe1;color:#1a7f37}}
  .shots{{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}}
  .thumb img{{height:120px;border:1px solid #d0d7de;border-radius:6px;cursor:zoom-in;object-fit:cover}}
  .lightbox{{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99;align-items:center;justify-content:center;padding:20px;cursor:zoom-out}}
  .lightbox:target{{display:flex}}
  .lightbox img{{max-width:100%;max-height:100%;box-shadow:0 0 40px #000}}
</style></head>
<body>
  <h1>Import Lab Recform — Report</h1>
  <p class="sub">{esc(m.get("recform_name", ""))}</p>
  <table class="meta">{meta_rows}</table>
  <div class="summary">
    <div class="card"><div class="big">{n_total}</div><div class="lbl">Steps</div></div>
    <div class="card"><div class="big">{n_ok}</div><div class="lbl">Succeeded</div></div>
    <div class="card"><div class="big">{n_confirm}</div><div class="lbl">User-confirmed</div></div>
    <div class="card"><div class="big">{len(tbc)}</div><div class="lbl">TBC / Failed</div></div>
  </div>
  {tbc_html}
  {steps_html}
</body></html>'''

    slug = m.get("slug") or "recform"
    out = manifest_path.rsplit("/", 1)[0] + f"/report-{slug}.html" \
        if "/" in manifest_path else f"report-{slug}.html"
    with open(out, "w") as f:
        f.write(doc)
    print(out)


if __name__ == "__main__":
    main()
