"""
Auto-assign key names to detected form fields using PDF text proximity matching.

Algorithm (see docs/key-assignment-pipeline.md for full rationale):
  1. Per-field context (direction-aware):
       - Textbox/Signature: text to the LEFT (220 pts) + nearest line ABOVE.
       - Checkbox: text to the RIGHT (150 pts) + column header above. Dense grids
         (box height < 8 pts) prepend a tight y-center band so the own row wins.
  2. Score every (field, key) pair = match_ratio × position_score:
       - match_ratio: fraction of key tokens found (exact, alias, or fuzzy ≥ 0.85).
       - position_score: 1/(distance + 10). Distance from context START for
         checkboxes, from context END for textboxes (nearest label wins).
       - ×1.5 bonus if key prefix matches the ALL-CAPS section title above.
  3. Globally-optimal one-to-one matching (Hungarian) over the score matrix.
  4. Reading-order reorder for same-base key families (Current/Future, C2/F2),
     guarded so it never overrides a clearly context-justified assignment.
  5. Optional Gemini fallback (--use-llm) / vision refinement (--vision).

Usage:
    python assign_keys.py <flatten.json> <key.json> <input.pdf> <output.json>
                          [--min-score 0.005] [--drop-unmatched]
                          [--use-llm] [--llm-model gemini-2.0-flash]
                          [--vision] [--vision-model gemini-2.5-flash] [--vision-trust 0.05]

NOTE: <input.pdf> must be the ORIGINAL PDF with a text layer (pdf_raw/), NOT a
flattened render — context extraction reads embedded text.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path

import pypdfium2


def _open_textpages(pdf_path: str) -> tuple[pypdfium2.PdfDocument, dict[int, tuple]]:
    """Returns doc and {page_ix: (textpage, page_width)}."""
    doc = pypdfium2.PdfDocument(pdf_path)
    return doc, {i: (doc[i].get_textpage(), doc[i].get_width()) for i in range(len(doc))}


def _column_header(tp, x0: float, x1: float, y1: float, height: float = 120) -> str:
    """
    Nearest text line directly ABOVE the field in a narrow x-band.
    Generic table disambiguator: for grid layouts (e.g. Current/Future columns)
    the column header is the closest text above the checkbox in its own column.
    """
    above = tp.get_text_bounded(x0 - 3, y1 + 1, x1 + 5, y1 + height) or ""
    lines = [l.strip() for l in above.splitlines() if l.strip()]
    return lines[-1] if lines else ""  # last line = closest to the field


def _section_header(tp, x0: float, y1: float, page_w: float,
                    max_height: float = 250) -> str:
    """
    Nearest mostly-UPPERCASE line above the field (full page width) — section
    titles like \"PATIENT INFORMATION\" / \"ORDERING PROVIDER\". Disambiguates
    identical labels (Phone, Address, City…) repeated across form sections,
    matching the key prefix (patient_*, order_*, network_*).

    Filters page-header/footer lines (e.g. \"CLIA ID: 31D2263712\") by requiring
    at least 2 pure-alpha words of length ≥ 3 — form section titles always have
    2+ descriptive words, while IDs and codes do not.
    """
    text = tp.get_text_bounded(0, y1 + 1, page_w, y1 + max_height) or ""
    for line in reversed([l.strip() for l in text.splitlines() if l.strip()]):
        letters = [c for c in line if c.isalpha()]
        if len(letters) < 4 or sum(c.isupper() for c in letters) / len(letters) <= 0.8:
            continue
        alpha_words = [w for w in line.split() if w.isalpha() and len(w) >= 3]
        if len(alpha_words) >= 2:
            return line
    return ""


def _get_context(field: dict, textpages: dict) -> str:
    """
    LEFT 220 pts for textboxes (labels inline before field);
    RIGHT 150 pts for checkboxes (option label), plus nearest column header above.
    """
    page = field["page"]
    entry = textpages.get(page)
    if entry is None:
        return ""
    tp, page_w = entry
    x0, y0, x1, y1 = (float(v) for v in field["rect"].split(","))
    if field.get("subject") == "Checkbox":
        # Small checkboxes (dense grids/lists, row pitch ≈ box height) bleed
        # into adjacent rows with a generous band. Put the tight center-band
        # text FIRST (own row wins via position scoring) and append the
        # generous band as fallback for labels sitting above/below the box.
        generous = tp.get_text_bounded(x1, y0 - 4, x1 + 150, y1 + 4) or ""
        if (y1 - y0) < 8:
            yc = (y0 + y1) / 2
            tight = tp.get_text_bounded(x1, yc - 3, x1 + 150, yc + 3) or ""
            ctx = f"{tight} {generous}" if tight else generous
        else:
            ctx = generous
        header = _column_header(tp, x0, x1, y1)
        return f"{ctx} {header}" if header else ctx
    else:
        # Label may be inline-left (\"Name: ___\") or just above the box
        # (\"First Name\" over an underline). Append the above-label LAST:
        # from_end scoring then prefers it over left-side bleed from the
        # previous field on the same row. Section header (\"PATIENT
        # INFORMATION\") disambiguates identical labels across sections.
        # Use ALL lines above (not just lines[-1]) so stacked annotations
        # like \"Phone Number\\nREQUIRED\" don't hide the actual column header.
        left = tp.get_text_bounded(x0 - 220, y0 - 4, x0, y1 + 4) or ""
        above_raw = tp.get_text_bounded(x0 - 3, y1 + 1, x1 + 5, y1 + 25) or ""
        above = " ".join(l.strip() for l in above_raw.splitlines() if l.strip())
        return f"{left} {above}" if above else left


# Suffixes that identify a key as a text-input field rather than a checkbox option.
# Keys whose last token is in this set are treated as textbox keys;
# keys that belong to an option group (multiple siblings) and whose last token is
# NOT here are treated as checkbox-option keys. Mismatches are penalised in scoring.
_TEXTBOX_SUFFIXES = frozenset({
    "name", "npi", "fax", "email", "address", "city", "state",
    "zip", "phone", "dob", "date", "signature", "number", "group",
    "id", "text", "code", "codes", "citation", "specify", "dx", "grade",
})


def _option_key_names(keys: list[str]) -> set[str]:
    """
    Returns key names that belong to a multi-option group (checkbox siblings).
    Two detection levels:
      L1: rsplit('_', 1) prefix — catches e.g. patient_gender_Male/_Female
      L2: first 2 underscore segments — catches e.g. testing_criteria_*/
          family_cancer_*/ submission_checklist_* groups whose last tokens vary
    Keys whose last token is in _TEXTBOX_SUFFIXES are excluded (they are text
    inputs, not checkbox options — e.g. order_physician_1_name/_npi siblings).
    """
    l1_counts: dict[str, int] = {}
    for k in keys:
        parts = k.rsplit("_", 1)
        if len(parts) > 1:
            l1_counts[parts[0]] = l1_counts.get(parts[0], 0) + 1

    l2_counts: dict[str, int] = {}
    for k in keys:
        segs = k.split("_")
        if len(segs) >= 3:
            pref2 = segs[0] + "_" + segs[1]
            l2_counts[pref2] = l2_counts.get(pref2, 0) + 1

    result = set()
    for k in keys:
        parts = k.rsplit("_", 1)
        in_group = len(parts) > 1 and l1_counts.get(parts[0], 0) >= 2
        if not in_group:
            segs = k.split("_")
            if len(segs) >= 3:
                pref2 = segs[0] + "_" + segs[1]
                in_group = l2_counts.get(pref2, 0) >= 2
        if in_group:
            last_tok = _clean(k.rsplit("_", 1)[-1]).strip()
            if last_tok not in _TEXTBOX_SUFFIXES:
                result.add(k)
    return result


# Universal form-field abbreviations: key token → phrases to also search in context.
_TOKEN_ALIASES = {
    "dob": ["date of birth", "birth date", "birthdate"],
    "ssn": ["social security"],
    "npi": ["national provider"],
    "id": ["identification"],
}


def _tokens(key: str) -> list[str]:
    """Split key on underscores; drop single-char and numeric-only parts."""
    return [p for p in re.split(r"[_\s]+", key.lower()) if len(p) > 1 and not p.isdigit()]


def _clean(text: str) -> str:
    """Lowercase and replace punctuation with spaces (\"I69.30\" → \"i69 30\")."""
    return re.sub(r"[^a-z0-9\s]", " ", text.lower())


def _fuzzy_pos(token: str, words: list[tuple[str, int]], cache: dict,
               prefer_last: bool = False) -> int:
    """
    Position of a fuzzy word match (ratio ≥ 0.85) — handles PDF typos like
    \"Pitavastain\" vs key token \"pitavastatin\". Returns -1 if none.
    prefer_last: among equally-good matches pick the latest occurrence.
    """
    ck = (token, prefer_last)
    if ck in cache:
        return cache[ck]
    import difflib
    best_pos, best_ratio = -1, 0.85
    for w, pos in words:
        if abs(len(w) - len(token)) > 2 or len(w) < 4:
            continue
        r = difflib.SequenceMatcher(None, token, w).ratio()
        if r > best_ratio or (r == best_ratio and prefer_last and pos > best_pos):
            best_ratio, best_pos = r, pos
    cache[ck] = best_pos
    return best_pos


def _score(key: str, ctx: str, words: list[tuple[str, int]], fuzzy_cache: dict,
           from_end: bool = False) -> float:
    """
    Score = match_ratio × position_score.
    match_ratio: fraction of key tokens found in context (exact or fuzzy).
    position_score: 1/(distance + 10), where distance is measured from the
    context START for RIGHT-side contexts (checkbox: first-appearing drug name
    is the field's own row) and from the context END for LEFT-side contexts
    (textbox: the label nearest the field wins — \"First Name: __ Last Name: __\"
    rows would otherwise leak the left neighbour's label).
    """
    toks = _tokens(key)
    if not toks:
        return 0.0

    min_dist = len(ctx) + 1
    matched = 0
    for t in toks:
        t = _clean(t).strip()
        pos = (ctx.rfind(t) if from_end else ctx.find(t))
        tlen = len(t)
        if pos < 0:
            for alias in _TOKEN_ALIASES.get(t, []):
                pos = (ctx.rfind(alias) if from_end else ctx.find(alias))
                if pos >= 0:
                    tlen = len(alias)
                    break
        if pos < 0 and len(t) >= 4:
            pos = _fuzzy_pos(t, words, fuzzy_cache, prefer_last=from_end)
        if pos >= 0:
            matched += 1
            dist = (len(ctx) - (pos + tlen)) if from_end else pos
            min_dist = min(min_dist, max(0, dist))

    if matched == 0:
        return 0.0

    match_ratio = matched / len(toks)
    pos_score = 1.0 / (min_dist + 10)
    return match_ratio * pos_score


def _key_base(key: str) -> str:
    """Key without its last underscore-delimited token: 'a_b_Current' → 'a_b'."""
    parts = key.rsplit("_", 1)
    return parts[0] if len(parts) > 1 else key


def _reading_order(field: dict) -> tuple:
    """
    Sort key: page → top-to-bottom → left-to-right.
    y is quantized into 6pt row bands so same-row fields (with small y noise)
    tie on the band and fall back to x-order.
    """
    x0, y0, _, _ = (float(v) for v in field["rect"].split(","))
    return (field["page"], -round(y0 / 6), x0)


def _reorder_by_x(field_to_key: dict[int, int], fields: list[dict], keys: list[str],
                  score_matrix=None) -> None:
    """
    For each group of fields sharing the same key-base, re-assign keys in reading
    order so the first field (top-left) gets the key appearing earliest in key.json.
    Fixes Current/Future column order, M/F pairs, and repeated occurrences (C2/F2).

    Only applied when it does NOT reduce total match score: ambiguous groups
    (identical contexts, e.g. Current/Future pairs) reorder freely, while groups
    whose contexts already distinguish them (e.g. ICD code lists sharing one
    key-base) keep their context-driven assignment.
    """
    base_to_fis: dict[str, list[int]] = defaultdict(list)
    for fi, ki in field_to_key.items():
        base_to_fis[_key_base(keys[ki])].append(fi)

    for fis in base_to_fis.values():
        if len(fis) < 2:
            continue
        ki_sorted = sorted(field_to_key[fi] for fi in fis)        # ascending ki = key.json order
        fis_ordered = sorted(fis, key=lambda fi: _reading_order(fields[fi]))
        proposed = dict(zip(fis_ordered, ki_sorted))

        if score_matrix is not None:
            cur = sum(score_matrix[fi, field_to_key[fi]] for fi in fis)
            new = sum(score_matrix[fi, ki] for fi, ki in proposed.items())
            # Relative tolerance: near-tie groups (identical-context pairs like
            # Current/Future or repeated C2/F2 rows) reorder freely; only block
            # when reorder clearly destroys context-justified assignments.
            if new < cur * 0.9:
                continue

        field_to_key.update(proposed)


def _llm_fallback(
    unmatched_fis: list[int],
    fields: list[dict],
    contexts: list[str],
    keys: list[str],
    used_ki: set[int],
    model: str,
) -> dict[int, int]:
    """Send unmatched fields + unused keys to Gemini; return {fi: ki} assignments."""
    from google import genai  # lazy import — only needed when --use-llm is set

    available = [(ki, k) for ki, k in enumerate(keys) if ki not in used_ki]
    if not available:
        return {}

    field_items = [
        {
            "index": fi,
            "type": fields[fi].get("subject", "Unknown"),
            "page": fields[fi]["page"],
            "context": contexts[fi].strip(),
        }
        for fi in unmatched_fis
    ]

    prompt = (
        "Assign key names to unmatched medical form fields.\n\n"
        "AVAILABLE KEYS (each used at most once, use EXACT strings):\n"
        f"{json.dumps([k for _, k in available], ensure_ascii=False)}\n\n"
        "FIELDS (Textbox/Signature: context=LEFT label; Checkbox: context=RIGHT option):\n"
        f"{json.dumps(field_items, indent=2, ensure_ascii=False)}\n\n"
        "Abbreviations: dob=Date of Birth, M/F=Male/Female, etc.\n"
        "Return ONLY JSON, no markdown:\n"
        '{"assignments": [{"field_index": 0, "key": "exact_key_name"}, ...]}'
    )

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("  ⚠ GEMINI_API_KEY not set — skipping LLM fallback")
        return {}

    client = genai.Client(api_key=api_key)
    print(f"  LLM fallback: {len(unmatched_fis)} fields → {model}…")
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config={"response_mime_type": "application/json"},
    )

    raw = json.loads(response.text)
    key_name_to_ki = {k: ki for ki, k in available}
    fi_to_ki: dict[int, int] = {}
    used_in_llm: set[int] = set()

    for item in raw.get("assignments", []):
        fi = item.get("field_index")
        key = item.get("key")
        if fi not in unmatched_fis or key not in key_name_to_ki:
            continue
        ki = key_name_to_ki[key]
        if fi in fi_to_ki or ki in used_in_llm:
            continue
        fi_to_ki[fi] = ki
        used_in_llm.add(ki)

    return fi_to_ki


def assign_keys(
    flatten_path: str | Path,
    key_path: str | Path,
    pdf_path: str | Path,
    output_path: str | Path,
    min_score: float = 0.005,
    drop_unmatched: bool = False,
    use_llm: bool = False,
    llm_model: str = "gemini-2.0-flash",
    vision: bool = False,
    vision_model: str = "gemini-2.5-flash",
    vision_trust: float = 0.05,
) -> None:
    with open(flatten_path, encoding="utf-8") as f:
        fields: list[dict] = json.load(f)
    with open(key_path, encoding="utf-8") as f:
        keys: list[str] = json.load(f)

    doc, textpages = _open_textpages(str(pdf_path))
    contexts = [_get_context(field, textpages) for field in fields]
    # Section title above each field (e.g. "PATIENT INFORMATION") — used as a
    # score bonus to disambiguate identical labels across form sections.
    sections = []
    for field in fields:
        entry = textpages.get(field["page"])
        if entry is None:
            sections.append("")
            continue
        tp, page_w = entry
        x0, _, _, y1 = (float(v) for v in field["rect"].split(","))
        sections.append(_clean(_section_header(tp, x0, y1, page_w)))
    doc.close()

    # Precompute cleaned context + word positions per field (used by fuzzy matching)
    ctxs_clean = [_clean(c) for c in contexts]
    ctx_words = [
        [(m.group(0), m.start()) for m in re.finditer(r"[a-z0-9]+", c)]
        for c in ctxs_clean
    ]
    fuzzy_caches: list[dict] = [{} for _ in fields]

    # Globally-optimal one-to-one matching (Hungarian algorithm) — avoids the
    # cascade errors of greedy assignment where one wrong match steals keys
    # from all subsequent fields.
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    # LEFT-side contexts (textbox/signature) measure label distance from the
    # field; RIGHT-side contexts (checkbox) from the start of the option text.
    from_end_flags = [f.get("subject") != "Checkbox" for f in fields]

    # Pre-compute option groups for type-mismatch penalty: keys that are
    # checkbox options (multi-sibling group, last token not a textbox suffix).
    cb_option_keys = _option_key_names(keys)

    def _cell(fi: int, key: str) -> float:
        s = _score(key, ctxs_clean[fi], ctx_words[fi], fuzzy_caches[fi],
                   from_end=from_end_flags[fi])
        if s > 0 and sections[fi]:
            # Key prefix matching the section title (patient_* under
            # "PATIENT INFORMATION") outranks same-label keys of other sections.
            toks = _tokens(key)
            if toks and _clean(toks[0]).strip() in sections[fi]:
                s *= 1.5
        if s > 0:
            # Type-mismatch penalty: checkbox-semantic keys strongly prefer
            # Checkbox fields; textbox-semantic keys strongly prefer non-Checkbox.
            # This prevents e.g. patient_gender_Male going to a textbox because
            # "Male" text appears in the left context of the phone field.
            is_cb = not from_end_flags[fi]
            last_tok = _tokens(key)[-1] if _tokens(key) else ""
            key_is_cb_option = key in cb_option_keys
            key_is_textbox = last_tok in _TEXTBOX_SUFFIXES
            if key_is_cb_option and not is_cb:
                s *= 0.2   # checkbox-option key → textbox field: strongly penalise
            elif key_is_textbox and is_cb:
                s *= 0.5   # textbox key → checkbox field: penalise
        return s

    score_matrix = np.array(
        [[_cell(fi, key) for key in keys] for fi in range(len(fields))]
    )
    row_idx, col_idx = linear_sum_assignment(score_matrix, maximize=True)

    field_to_key: dict[int, int] = {}
    used_ki: set[int] = set()
    for fi, ki in zip(row_idx, col_idx):
        if score_matrix[fi, ki] >= min_score:
            field_to_key[int(fi)] = int(ki)
            used_ki.add(int(ki))

    _reorder_by_x(field_to_key, fields, keys, score_matrix)

    # LLM fallback for fields that scored below threshold
    if use_llm:
        unmatched_fis = [i for i in range(len(fields)) if i not in field_to_key]
        if unmatched_fis:
            llm_assignments = _llm_fallback(
                unmatched_fis, fields, contexts, keys, used_ki, llm_model
            )
            field_to_key.update(llm_assignments)
            used_ki.update(llm_assignments.values())
            _reorder_by_x(field_to_key, fields, keys, score_matrix)

    # Optional vision refinement: Gemini looks at rendered pages with numbered
    # boxes and corrects spatially-ambiguous assignments (column pairs,
    # repeated drugs, misaligned detection boxes).
    if vision:
        from vision_refine import refine_with_vision
        heuristic_scores = {fi: float(score_matrix[fi, ki]) for fi, ki in field_to_key.items()}
        field_to_key = refine_with_vision(
            fields, keys, field_to_key, str(pdf_path), model=vision_model,
            heuristic_scores=heuristic_scores, trust_threshold=vision_trust,
        )

    # Write output
    low_confidence: list[str] = []
    result = []
    for i, field in enumerate(fields):
        if i in field_to_key:
            out = dict(field)
            out["contents"] = keys[field_to_key[i]]
            result.append(out)
        else:
            low_confidence.append(
                f"  [{i}] page={field['page']} {field.get('subject')} rect={field['rect'][:30]}…"
            )
            if not drop_unmatched:
                result.append(dict(field))

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    kept = "dropped" if drop_unmatched else "kept"
    print(f"Assigned {len(field_to_key)}/{len(fields)} fields → {output_path}")
    if low_confidence:
        print(f"  ⚠ {len(low_confidence)} unmatched ({kept}), score < {min_score}:")
        for line in low_confidence:
            print(line)


def main() -> None:
    parser = argparse.ArgumentParser(description="Assign key names to detected form fields")
    parser.add_argument("flatten",     type=Path, help="Raw detect output JSON (flatten)")
    parser.add_argument("keys",        type=Path, help="key.json with ordered field names")
    parser.add_argument("pdf",         type=Path, help="Source PDF")
    parser.add_argument("output",      type=Path, help="Output DONE JSON")
    parser.add_argument("--min-score",      type=float, default=0.005, dest="min_score",
                        help="Minimum match score (default: 0.005)")
    parser.add_argument("--drop-unmatched", action="store_true", dest="drop_unmatched",
                        help="Exclude unmatched fields from output (default: keep with original contents)")
    parser.add_argument("--use-llm",        action="store_true", dest="use_llm",
                        help="Use Gemini LLM as fallback for unmatched fields (requires GEMINI_API_KEY)")
    parser.add_argument("--llm-model",      default="gemini-2.0-flash", dest="llm_model",
                        help="Gemini model for LLM fallback (default: gemini-2.0-flash)")
    parser.add_argument("--vision",         action="store_true",
                        help="Refine assignments with Gemini vision on rendered pages (requires GEMINI_API_KEY)")
    parser.add_argument("--vision-model",   default="gemini-2.5-flash", dest="vision_model",
                        help="Gemini model for vision refinement (default: gemini-2.5-flash)")
    parser.add_argument("--vision-trust",   type=float, default=0.05, dest="vision_trust",
                        help="Heuristic score above which vision cannot override (default: 0.05)")
    args = parser.parse_args()
    assign_keys(args.flatten, args.keys, args.pdf, args.output,
                min_score=args.min_score, drop_unmatched=args.drop_unmatched,
                use_llm=args.use_llm, llm_model=args.llm_model,
                vision=args.vision, vision_model=args.vision_model,
                vision_trust=args.vision_trust)


if __name__ == "__main__":
    main()
