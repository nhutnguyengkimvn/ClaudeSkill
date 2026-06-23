"""
Run form field detection on a PDF (or all PDFs in a directory) and output positions as JSON.

Single file:
    python detect_to_json.py input.pdf output.json [options]

Directory (batch):
    python detect_to_json.py pdf_raw/ output/flattens/ [options]
    → produces output/flattens/<stem>-flatten.json for every *.pdf in pdf_raw/

Output format matches Foxit annotation JSON with absolute PDF point coordinates.
"""
from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pypdfium2

from commonforms.inference import (
    FFDetrDetector,
    FFDNetDetector,
    render_pdf,
)


_SUBJECT_MAP = {
    "TextBox": "Textbox",
    "ChoiceButton": "Checkbox",
    "Signature": "Signature",
}


def _pdf_date(dt: datetime) -> str:
    offset = dt.utcoffset()
    if offset is None:
        return f"D:{dt.strftime('%Y%m%d%H%M%S')}"
    total_seconds = int(offset.total_seconds())
    sign = "+" if total_seconds >= 0 else "-"
    h, m = divmod(abs(total_seconds) // 60, 60)
    return f"D:{dt.strftime('%Y%m%d%H%M%S')}{sign}{h:02d}'{m:02d}'"


def _get_page_dimensions_pts(pdf_path: str) -> list[tuple[float, float]]:
    doc = pypdfium2.PdfDocument(pdf_path)
    dims = []
    for page in doc:
        dims.append((page.get_width(), page.get_height()))
        page.close()
    doc.close()
    return dims


def detect_to_json(
    input_path: str | Path,
    output_path: str | Path,
    *,
    model_or_path: str = "FFDNet-L",
    device: str = "cpu",
    image_size: int = 1024,
    confidence: float = 0.4,
    fast: bool = False,
    batch_size: int = 4,
) -> None:
    input_path = str(input_path)

    if "FFDNET" in model_or_path.upper():
        detector = FFDNetDetector(model_or_path, device=device, fast=fast)
    else:
        detector = FFDetrDetector(model_or_path)

    pages = render_pdf(input_path)
    page_dims = _get_page_dimensions_pts(input_path)

    if isinstance(detector, FFDetrDetector):
        results = detector.extract_widgets(
            pages, confidence=confidence, image_size=image_size, batch_size=batch_size
        )
    else:
        results = detector.extract_widgets(
            pages, confidence=confidence, image_size=image_size
        )

    now = datetime.now(tz=timezone(timedelta(hours=7)))
    date_str = _pdf_date(now)

    annotations = []
    for page_ix, widgets in results.items():
        page_w, page_h = page_dims[page_ix]
        for i, widget in enumerate(widgets):
            bb = widget.bounding_box
            # Convert normalized coords (origin top-left) → PDF points (origin bottom-left)
            x0 = bb.x0 * page_w
            x1 = bb.x1 * page_w
            y0 = (1 - bb.y1) * page_h
            y1 = (1 - bb.y0) * page_h
            rect = f"{x0},{y0},{x1},{y1}"

            annotations.append({
                "date": date_str,
                "name": str(uuid.uuid4()),
                "page": page_ix,
                "rect": rect,
                "type": "freetext",
                "color": "#ff0000",
                "flags": "print",
                "style": "solid",
                "title": "CommonForms",
                "width": 0,
                "opacity": 1,
                "subject": _SUBJECT_MAP[widget.widget_type],
                "contents": f"{page_ix}_{i}",
                "fontColor": "#000000",
                "creationdate": date_str,
                "customEntries": {},
                "justification": 0,
                "defaultappearance": "8 Tf 1.00 0.00 0.00 rg",
            })

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(annotations, f, indent=2, ensure_ascii=False)

    print(f"Detected {len(annotations)} fields → {output_path}")


def _detect_kwargs(args: argparse.Namespace) -> dict:
    return dict(
        model_or_path=args.model,
        device=args.device,
        image_size=args.image_size,
        confidence=args.confidence,
        fast=args.fast,
        batch_size=args.batch_size,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Detect form fields in a PDF or directory of PDFs"
    )
    parser.add_argument("input",  type=Path, help="Input PDF file or directory of PDFs")
    parser.add_argument("output", type=Path, help="Output JSON file (single) or output directory (batch)")
    parser.add_argument("--model",       default="FFDNet-L", help="Model name or path (default: FFDNet-L)")
    parser.add_argument("--device",      default="cpu")
    parser.add_argument("--image-size",  type=int,   default=1024, dest="image_size")
    parser.add_argument("--confidence",  type=float, default=0.4)
    parser.add_argument("--fast",        action="store_true")
    parser.add_argument("--batch-size",  type=int,   default=4, dest="batch_size")

    args = parser.parse_args()
    kwargs = _detect_kwargs(args)

    if args.input.is_dir():
        # Batch mode: process every PDF in the directory
        pdfs = sorted(args.input.glob("*.pdf"))
        if not pdfs:
            print(f"No PDF files found in {args.input}")
            return
        args.output.mkdir(parents=True, exist_ok=True)
        for pdf in pdfs:
            out = args.output / f"{pdf.stem}-flatten.json"
            print(f"\n→ {pdf.name}")
            detect_to_json(pdf, out, **kwargs)
        print(f"\nProcessed {len(pdfs)} file(s) → {args.output}/")
    else:
        detect_to_json(args.input, args.output, **kwargs)


if __name__ == "__main__":
    main()
