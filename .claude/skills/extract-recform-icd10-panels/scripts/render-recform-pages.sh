#!/usr/bin/env bash
# Render a lab requisition PDF into legible slices for visual reading.
#
# Why: these AlphaDERA requisition forms are FLATTENED — every page is a single
# image with NO text layer, so pdftotext/pypdf return 0 characters and there is
# nothing to parse. The only reliable route is to render at 300 DPI, cut each
# page into overlapping horizontal strips, and read the strips with Claude's
# Read tool. At page scale the ICD digits are ambiguous (6/8, 0/O, .A0/.80);
# at 300 DPI + ~1700px wide strips they are not.
#
# Usage: render-recform-pages.sh <pdf> <out-dir> [first-page] [last-page]
set -euo pipefail

PDF="${1:?usage: render-recform-pages.sh <pdf> <out-dir> [first] [last]}"
OUT="${2:?missing out-dir}"
FIRST="${3:-1}"
LAST="${4:-}"

command -v pdftoppm >/dev/null || { echo "need poppler (pdftoppm)"; exit 1; }
command -v magick   >/dev/null || { echo "need imagemagick (magick)"; exit 1; }

mkdir -p "$OUT"
PAGES=$(pdfinfo "$PDF" | awk '/^Pages:/{print $2}')
LAST="${LAST:-$PAGES}"
echo "pdf=$PDF pages=$PAGES rendering $FIRST..$LAST at 300dpi -> $OUT"

# text-layer check: if the PDF *does* have text, say so — parsing beats reading
CHARS=$(pdftotext -layout "$PDF" - 2>/dev/null | tr -d '[:space:]' | wc -c | tr -d ' ')
echo "text-layer characters: $CHARS $( [ "$CHARS" -lt 200 ] && echo '(flattened — visual reading required)' || echo '(has text — try parsing first)')"

pdftoppm -r 300 -png -f "$FIRST" -l "$LAST" "$PDF" "$OUT/pg"

# 3 strips per page with ~80px overlap so no table row is cut in half
for f in "$OUT"/pg-*.png; do
  base=$(basename "$f" .png)
  H=$(magick identify -format "%h" "$f")
  step=$(( H / 3 ))
  for i in 0 1 2; do
    off=$(( i * step )); [ "$i" -gt 0 ] && off=$(( off - 80 ))
    magick "$f" -crop "x$(( step + 120 ))+0+${off}" +repage -resize 1700x -sharpen 0x1 \
      "$OUT/${base}-s${i}.png"
  done
done

echo "strips:"
ls "$OUT"/pg-*-s*.png
echo
echo "Next: Read each strip, then write the JSON and validate it with"
echo "  scripts/validate-recform-json.py <json>"
