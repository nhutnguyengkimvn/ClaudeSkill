# Workflow 03 — Flatten PDF & Upload

> `<DASHBOARD_URL>` = the base URL the user supplied in Phase 0.
> `<ORIGINAL_PDF_PATH>` = the exact path the user supplied for this PDF.
> `<original name>` = the PDF's filename without the `.pdf` extension.
> `<pdf dir>` = the directory containing `<ORIGINAL_PDF_PATH>`.
> The flattened output is written to `<pdf dir>/<original name>-flatten-pdf.pdf`
> (same folder as the original).

## Step 1 — Choose Flatten Method

**Ask the user once at the start of the entire batch (not per file):**

```
Which flatten method would you like to use for all PDFs?

Option A — sejda.com (online, browser-based)
Option B — Ghostscript command (local terminal, faster)

Reply "A" or "B"
```

Wait for user response before continuing. Use the chosen method for **all** PDFs in the batch.

---

## Option A — Flatten via sejda.com

### A1. Upload to sejda
1. Open new tab → navigate to: `https://www.sejda.com/flatten-pdf`
2. Click upload area → select the **ORIGINAL** PDF at `<ORIGINAL_PDF_PATH>`
3. Wait for sejda to finish processing

### A2. Download flattened file
1. Click the `Download` button **dropdown arrow** (small arrow next to Download button)
2. Select `Save as` from dropdown
3. Alert dialog appears with filename pre-filled
4. **APPEND** `-flatten-pdf` to the end of the filename:
   - `Immunodeficiency Panel - Amedix Inc` → `Immunodeficiency Panel - Amedix Inc-flatten-pdf`
   - `CGX rec_Amedix` → `CGX rec_Amedix-flatten-pdf`
5. Click OK → wait for download to complete
6. Move/save the file as `<pdf dir>/<original name>-flatten-pdf.pdf`

---

## Option B — Flatten via Ghostscript (terminal)

### B1. Run gs command
Open terminal and run:
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

### B2. Wait for completion
- gs will print progress to terminal
- When it returns to prompt → file is ready
- Output saved to `<pdf dir>/<original name>-flatten-pdf.pdf`

### B3. If gs not installed
- Report: `⚠️ Ghostscript not found. Please install via: brew install ghostscript`
- Ask user to install then retry, or switch to Option A

---

## Step 2 — Upload to dashboard

*(Same for both options)*

1. Navigate to: `<DASHBOARD_URL>/admin/ehealth/medicalrecform/`
2. Find and click the `Add PDF` button

## Step 3 — Fill Add PDF form

1. Upload the flattened file: `<pdf dir>/<original name>-flatten-pdf.pdf`
2. Find ReqForm dropdown:
   - Type Description (e.g. `CGX - Amedix 2026`)
   - Select the matching reqform created in Workflow 02

## Step 4 — Save

- Click `Save`
- Wait for success confirmation
- Report `✅ Workflow 03 done: PDF uploaded`
- Return to the per-recform **confirmation gate** in SKILL.md before continuing
  to the next PDF.
