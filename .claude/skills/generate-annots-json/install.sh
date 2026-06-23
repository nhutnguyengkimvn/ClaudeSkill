#!/usr/bin/env bash
# Install commonforms toolkit into a dedicated Python 3.11 venv.
# Requires torch which only supports Python <= 3.12.
set -e

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$SKILL_DIR/.venv"

# Prefer brew Python 3.11 (supports torch); fall back to system python3
PY311="$(find /usr/local/Cellar/python@3.11 -name "python3.11" -type f 2>/dev/null | head -1)"
if [ -z "$PY311" ]; then
  PY311="$(which python3.11 2>/dev/null || which python3)"
fi

if [ ! -d "$VENV" ]; then
  echo "Creating Python 3.11 venv at $VENV ..."
  "$PY311" -m venv "$VENV"
fi

"$VENV/bin/pip" install --quiet --upgrade pip

echo "Installing torch (may take a few minutes)..."
"$VENV/bin/pip" install --quiet torch

echo "Installing commonforms from GitHub..."
"$VENV/bin/pip" install --quiet "git+https://github.com/jbarrow/commonforms"

# Pin transformers 4.x + rfdetr 1.3.0 — compatible with torch 2.2.x (x86_64 macOS)
# transformers 5.x requires torch>=2.4 which is unavailable on x86_64 macOS
"$VENV/bin/pip" install --quiet "transformers==4.47.0" "rfdetr==1.3.0"

# Extra deps for form-key-verifier step
"$VENV/bin/pip" install --quiet pdfplumber pypdfium2 scipy numpy

echo "✅ generate-annots-json dependencies installed"
