#!/usr/bin/env python3
"""Detect Test Type + Lab from a Lab Req Form PDF by reading its CONTENT.

Usage:
    detect-recform-type.py <path-to.pdf>

Prints structured hints (title + lab candidates + page-1 text) that the skill
maps to a Short Code and Lab using references/abbreviation-map.md.

Run with the skills venv python so pypdf is available, e.g.:
    ~/.claude/skills/.venv/bin/python3 detect-recform-type.py "form.pdf"
"""
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("pypdf not installed. Run with the skills venv python "
             "(~/.claude/skills/.venv/bin/python3).")

# Marker that ends the form title. Handles "TEST REQUISITION FORM" and
# "TESTING REQUISITION FORM".
TITLE_END = re.compile(r"\bTEST(?:ING)?\s+REQUISITION\s+FORM\b", re.IGNORECASE)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)\.[A-Za-z]{2,}")
LAB_PHRASE = re.compile(r"([A-Za-z][A-Za-z&'\-]+)\s+Lab(?:oratory)?\b", re.IGNORECASE)
# Common words that precede "Lab" but are not a brand name.
STOPWORDS = {"the", "or", "and", "for", "a", "an", "of", "to", "with",
             "ordering", "send", "send the", "by", "from"}


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: detect-recform-type.py <path-to.pdf>")
    path = sys.argv[1]
    reader = PdfReader(path)
    page1 = (reader.pages[0].extract_text() or "").strip()
    full = "\n".join((p.extract_text() or "") for p in reader.pages)

    # --- Title: the 1-2 lines directly above the REQUISITION FORM marker ---
    m = TITLE_END.search(page1)
    if m:
        before = [ln.strip() for ln in page1[:m.start()].splitlines() if ln.strip()]
        title = " ".join(before[-2:]) if before else ""
    else:
        # Fallback: first non-empty line
        title = next((ln.strip() for ln in page1.splitlines() if ln.strip()), "")
    # Collapse whitespace/newlines so the title is one clean line.
    title = re.sub(r"\s+", " ", title).strip()

    # --- Lab candidates: email domains + "X Lab/Laboratory" phrases ---
    candidates = []
    for dom in EMAIL.findall(full):
        candidates.append(dom.split(".")[0])           # amedixlab -> amedixlab
    for word in LAB_PHRASE.findall(full):
        candidates.append(word)                         # AMEDiX / Hightech
    # Dedup case-insensitively, drop stopwords, keep first-seen casing.
    seen, labs = set(), []
    for c in candidates:
        key = c.lower()
        if key in STOPWORDS or len(key) < 3 or key in seen:
            continue
        seen.add(key)
        labs.append(c)

    print("=== DETECTED TITLE (map to Short Code via abbreviation-map.md) ===")
    print(title or "(none found)")
    print()
    print("=== LAB CANDIDATES (pick the lab brand, normalize via abbreviation-map.md) ===")
    print("\n".join(labs) if labs else "(none found)")
    print()
    print("=== PAGE 1 TEXT (truncated) ===")
    print(page1[:800])


if __name__ == "__main__":
    main()
