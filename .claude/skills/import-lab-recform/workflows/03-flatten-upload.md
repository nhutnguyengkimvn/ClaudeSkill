# Workflow 03 — Flatten PDF & Upload

> `<DASHBOARD_URL>` = the base URL the user supplied in Phase 0.
> `<ORIGINAL_PDF_PATH>` = the exact path the user supplied for this PDF.
> `<original name>` = the PDF's filename without the `.pdf` extension.
> `<pdf dir>` = the directory containing `<ORIGINAL_PDF_PATH>`.
> The flattened output is written to `<pdf dir>/<original name>-flatten-pdf.pdf`
> (same folder as the original).

## Step 1 — Flatten via Ghostscript

Run the following command in terminal:

```bash
gs -sDEVICE=pdfimage24 -r300 \
  -o "<pdf dir>/<original name>-flatten-pdf.pdf" \
  "<ORIGINAL_PDF_PATH>"
```

Example for a PDF at `/Users/nhut/Downloads/CGX rec_Amedix.pdf`:
```bash
gs -sDEVICE=pdfimage24 -r300 \
  -o "/Users/nhut/Downloads/CGX rec_Amedix-flatten-pdf.pdf" \
  "/Users/nhut/Downloads/CGX rec_Amedix.pdf"
```

- `gs` will print progress to terminal; when it returns to prompt → file is ready.
- **If `gs` not installed:** report `⚠️ Ghostscript not found. Please install via: brew install ghostscript` and wait for the user to install before retrying.

---

## Step 2 — Upload to dashboard

1. Navigate to: `<DASHBOARD_URL>/admin/ehealth/medicalrecform/`
2. Click the `Add PDF` button

## Step 3 — Fill Add PDF form

1. Upload the flattened file: `<pdf dir>/<original name>-flatten-pdf.pdf`
2. Find ReqForm dropdown:
   - Type Description (e.g. `CGX - Amedix <YEAR>`)
   - Select the matching reqform created in Workflow 02

## Step 4 — Save

- Click `Save`
- Wait for success confirmation
- Report `✅ Workflow 03 done: PDF uploaded`
- Continue to Workflow 04
