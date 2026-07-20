// pss-03: verify the case reached Pending (click "Mark as Pending" only if
// still needed) → screenshot. NO logout — the PSS session is intentionally
// left logged in at the end of this skill.
// No placeholders — run via mcp__playwright__browser_run_code_unsafe with
// {filename: "<abs path to this file>"} directly.
//
// Notes:
// - Saving a complete Compliance usually AUTO-transitions the case
//   New → Pending, so the button click is often unnecessary (idempotent).
// - Status must be read from the BADGE zone (text before "Case ID") — the
//   "Mark as Pending" BUTTON text would false-match /Pending/.
async (page) => {
  const out = { stage: 'mark-pending', ok: false };

  const jsClickSwal = (labels) => page.evaluate((ls) => {
    const btn = [...document.querySelectorAll('.swal-modal button, .swal2-popup button')]
      .find((b) => ls.includes(b.textContent.trim()) && b.offsetParent);
    if (btn) { const t = btn.textContent.trim(); btn.click(); return t; }
    return null;
  }, labels);
  const readBadgeZone = () => page.evaluate(() => {
    const t = document.body.innerText;
    const cut = t.indexOf('Case ID');
    return cut > 0 ? t.slice(0, cut) : t.slice(0, 80);
  });

  // idempotency: already Pending (auto-transition or re-run) → nothing to click
  const zoneBefore = await readBadgeZone();
  if (/\bPending\b/.test(zoneBefore)) {
    out.alreadyPending = true;
  } else {
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => /Mark as Pending/i.test(b.textContent) && !b.disabled && b.offsetParent);
      if (btn) { btn.click(); return true; } return false;
    });
    if (!clicked) {
      out.error = '"Mark as Pending" button not found/enabled — a required section may still be missing.';
      await page.screenshot({ path: './pss-mark-pending-missing.jpeg', type: 'jpeg', quality: 90 });
      return out;
    }
    // poll up to 10s: confirm (Yes) or validation block (OK)
    let confirmed = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !confirmed) {
      confirmed = await jsClickSwal(['Yes', 'OK']);
      if (!confirmed) await page.waitForTimeout(500);
    }
    if (confirmed === 'OK') {
      out.error = 'Mark as Pending blocked: "complete all required fields" — check sidebar for red *.';
      await page.screenshot({ path: './pss-mark-pending-blocked.jpeg', type: 'jpeg', quality: 90 });
      return out;
    }
    await page.waitForFunction(() => {
      const t = document.body.innerText;
      const cut = t.indexOf('Case ID');
      const zone = cut > 0 ? t.slice(0, cut) : t.slice(0, 80);
      return !/\bNew\b/.test(zone);
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
  }

  const head = await page.evaluate(() => document.body.innerText.slice(0, 300));
  const zone = await readBadgeZone();
  out.caseId = (head.match(/CA-[A-Z0-9]{8}/) || [null])[0];
  out.status = (zone.match(/\b(Pending|Assigned|New|Cancelled)\b/) || ['left New'])[0];
  out.screenshot = 'pss-case-marked-pending.jpeg';
  await page.screenshot({ path: './pss-case-marked-pending.jpeg', type: 'jpeg', quality: 90 });

  out.ok = /Pending|Assigned/.test(out.status);
  if (!out.ok) out.error = 'status=' + out.status;
  return out;
}
