// fast-03: click Submit → confirm Yes → verify status left Draft → screenshot.
// No placeholders — run via mcp__playwright__browser_run_code_unsafe with
// {filename: "<abs path to this file>"} directly.
//
// Notes:
// - swal buttons: JS-click only (overlay intercepts trusted clicks) and POLL for
//   the dialog — it can take a few seconds to appear.
// - Success = case leaves Draft. It can land on "New" (Mark as Pending button)
//   or progress straight to "Assigned" if a provider auto-picks it up.
// - If a "Please complete all required fields first" (OK) dialog appears, some
//   section lost its save → return the blocking error, do NOT retry blindly.
async (page) => {
  const out = { stage: 'submit-verify', ok: false };

  const jsClickSwal = (labels) => page.evaluate((ls) => {
    const btn = [...document.querySelectorAll('.swal-modal button, .swal2-popup button')]
      .find((b) => ls.includes(b.textContent.trim()) && b.offsetParent);
    if (btn) { const t = btn.textContent.trim(); btn.click(); return t; }
    return null;
  }, labels);

  // Classify a dialog by its TEXT, never by its button label. Three different
  // dialogs all offer an OK/Yes button here:
  //   'guard'   — "Your unsaved data on the current case will be lost" → OK, harmless
  //   'confirm' — "Are you sure you want to take this action?"          → Yes, proceed
  //   'blocked' — "Please complete all required fields first"           → real failure
  // Reading only the label made the guard dialog look like a validation block and
  // failed the run in 80ms with every section green (hit 2026-07-31).
  const dialogKind = () => page.evaluate(() => {
    const d = document.querySelector('.swal-modal, .swal2-popup');
    if (!d || !d.offsetParent) return null;
    const t = (d.textContent || '').toLowerCase();
    if (/unsaved data/.test(t)) return 'guard';
    if (/required fields|complete all/.test(t)) return 'blocked';
    if (/are you sure/.test(t)) return 'confirm';
    return 'other';
  });

  // a leftover guard dialog from the previous phase covers the header — clear it first
  for (let i = 0; i < 6 && (await dialogKind()) === 'guard'; i++) {
    await jsClickSwal(['OK']);
    await page.waitForTimeout(300);
  }

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /Submit/.test(b.textContent) && !b.disabled && b.offsetParent);
    btn?.click();
  });

  // poll up to 10s, answering each dialog by KIND
  let confirmed = null;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !confirmed) {
    const kind = await dialogKind();
    if (kind === 'blocked') {
      out.error = 'Submit blocked: "complete all required fields" — a section lost its save. Check sidebar for red *.';
      await page.screenshot({ path: './fast-submit-blocked.jpeg', type: 'jpeg', quality: 90 });
      return out;
    }
    if (kind === 'guard') {
      await jsClickSwal(['OK']);           // dismiss, then re-click Submit
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find((b) => /Submit/.test(b.textContent) && !b.disabled && b.offsetParent);
        btn?.click();
      });
    } else if (kind === 'confirm' || kind === 'other') {
      confirmed = await jsClickSwal(['Yes', 'OK']);
    }
    if (!confirmed) await page.waitForTimeout(250);
  }

  // success: the HEADER badge (first ~300 chars: "<name> <Badge> Case ID: …")
  // leaves Draft — the case can land on New or jump straight to Assigned
  await page.waitForFunction(() => {
    const head = document.body.innerText.slice(0, 300);
    return document.body.innerText.includes('Mark as Pending') || !/\bDraft\b/.test(head);
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const body = await page.evaluate(() => document.body.innerText);
  const head = body.slice(0, 300);
  out.caseId = (body.match(/CA-[A-Z0-9]{8}/) || [null])[0];
  out.patientId = (body.match(/PT-\d+/) || [null])[0];
  out.status = (head.match(/\b(New|Assigned|Pending|Cancelled)\b/) || ['left Draft'])[0];
  out.screenshot = 'case-submitted-fast-run.jpeg';
  await page.screenshot({ path: './case-submitted-fast-run.jpeg', type: 'jpeg', quality: 90 });
  out.ok = true;
  return out;
}
