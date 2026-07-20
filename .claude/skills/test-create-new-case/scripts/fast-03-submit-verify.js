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

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /Submit/.test(b.textContent) && !b.disabled && b.offsetParent);
    btn?.click();
  });

  // poll up to 10s for either the confirm (Yes) or a validation block (OK)
  let confirmed = null;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !confirmed) {
    confirmed = await jsClickSwal(['Yes', 'OK']);
    if (!confirmed) await page.waitForTimeout(500);
  }
  if (confirmed === 'OK') {
    out.error = 'Submit blocked: "complete all required fields" — a section lost its save. Check sidebar for red *.';
    await page.screenshot({ path: './fast-submit-blocked.jpeg', type: 'jpeg', quality: 90 });
    return out;
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
