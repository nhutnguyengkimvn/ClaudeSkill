// fast-02: on the open case detail view, complete + Save each section:
// Patient Information → Opt-In Consent → Primary Care Provider → Family History.
// Run via mcp__playwright__browser_run_code_unsafe: Read this file, replace the
// __CONFIG__ placeholder with the real JSON object, pass the result as `code`.
// CONFIG shape: { opt_in_consent: {...}, primary_care_provider: {...}, family_history: {...} }
//
// Safety rules (each save is VERIFIED, wrong-save aborts immediately):
// - Every save is confirmed against the activity log ("updated the case on
//   <Section>"). No confirmation within 12s → abort with failedSection.
// - Only VISIBLE Save buttons (offsetParent) — hidden section forms also have
//   Save buttons; clicking one saves EMPTY data and wipes that section.
// - swal buttons: JS-click + poll (dialogs render late, overlay blocks trusted clicks).
// - Section switch may pop "unsaved data will be lost" (OK) → answered.
// - Radios: Form.io inputs selected by input[name*=…][value=…]. DOM-disabled
//   radios mean the section is locked → save as-is, NEVER force a value
//   (forcing wrapper clicks once saved the WRONG Opt-In answer).
async (page) => {
  const CFG = __CONFIG__;
  const out = { stage: 'save-sections', saved: {}, ok: false };

  const jsClickSwal = (labels) => page.evaluate((ls) => {
    const btn = [...document.querySelectorAll('.swal-modal button, .swal2-popup button')]
      .find((b) => ls.includes(b.textContent.trim()) && b.offsetParent);
    if (btn) { const t = btn.textContent.trim(); btn.click(); return t; }
    return null;
  }, labels);

  const clickSection = async (name) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate((n) => {
        const es = [...document.querySelectorAll('strong')].filter((s) => s.textContent.trim() === n);
        es[es.length - 1]?.click();
      }, name);
      await page.waitForTimeout(1000);
      await jsClickSwal(['OK']); // unsaved-data navigation guard
      const opened = await page.evaluate((n) => {
        const h = [...document.querySelectorAll('h1,h2,h3')].find((e) => e.textContent.trim() === n);
        return !!(h && h.offsetParent);
      }, name);
      if (opened) return true;
    }
    return false;
  };

  // Save the ACTIVE section and verify via the activity log; abort on failure.
  const saveAndVerify = async (name) => {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
        .filter((b) => b.textContent.trim() === 'Save' && !b.disabled && b.offsetParent);
      btns[btns.length - 1]?.click();
    });
    // a confirm dialog may appear late — poll ~3s
    for (let t = 0; t < 6; t++) {
      if (await jsClickSwal(['Yes'])) break;
      await page.waitForTimeout(500);
    }
    // hard verification: activity log must show this section as the latest update
    const confirmed = await page.waitForFunction(
      (n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText),
      name, { timeout: 12000 }
    ).then(() => true).catch(() => false);
    if (!confirmed) {
      out.error = 'Save NOT confirmed by activity log'; out.failedSection = name;
      await page.screenshot({ path: './fast-section-save-failed.jpeg', type: 'jpeg', quality: 90 });
    }
    return confirmed;
  };

  // 8a — Patient Information (pre-filled by the create wizard, just Save)
  if (!(await clickSection('Patient Information'))) { out.error = 'Patient Information did not open'; return out; }
  if (!(await saveAndVerify('Patient Information'))) return out;
  out.saved.patientInformation = true;

  // 8b — Opt-In Consent
  if (!(await clickSection('Opt-In Consent'))) { out.error = 'Opt-In Consent did not open'; return out; }
  const perm = CFG.opt_in_consent.permission_to_speak_with_provider; // "Yes" | "No"
  const q1 = page.locator('input[name*="opt_in_consent_q1"][value="' + perm + '"]');
  if (await q1.first().isDisabled().catch(() => true)) {
    out.optInLocked = true; // already recorded/locked — do NOT force
  } else {
    await q1.first().check({ force: true });
    await page.locator('input[name*="opt_in_consent_proof_method"][value="' + CFG.opt_in_consent.consent_proof_method + '"]').check({ force: true });
    await page.waitForTimeout(300);
    // value guard: abort rather than save a wrong consent answer
    const checked = await page.evaluate(() =>
      [...document.querySelectorAll('input[name*="opt_in_consent_q1"]')].filter(r => r.checked).map(r => r.value));
    if (!checked.includes(perm)) {
      out.error = 'Opt-In answer mismatch before save'; out.want = perm; out.got = checked;
      return out;
    }
    if (!(await saveAndVerify('Opt-In Consent'))) return out;
  }
  out.saved.optInConsent = true;
  out.optInAnswer = perm; // "No" normally auto-cancels + DNC — warn in report

  // 8c — Primary Care Provider
  if (!(await clickSection('Primary Care Provider'))) { out.error = 'Primary Care Provider did not open'; return out; }
  if (CFG.primary_care_provider.pcp_information_unavailable) {
    const box = page.getByRole('checkbox', { name: 'Primary Care Provider (PCP) information unavailable' }).first();
    if (!(await box.isChecked().catch(() => false))) { await box.check({ force: true }); await page.waitForTimeout(800); }
    const reasonSelected = await page.evaluate(() => {
      const sel = document.querySelector('[id*="pcp_no_pcp_reason"]');
      return !!sel?.closest('.choices')?.querySelector('.choices__list--single .choices__item');
    });
    if (!reasonSelected) {
      await page.locator('.choices').filter({ has: page.locator('[id*="pcp_no_pcp_reason"]') }).first().click();
      await page.locator('.choices__list--dropdown [role="option"]').filter({ hasText: CFG.primary_care_provider.reason_for_missing_info }).first().click();
      await page.waitForTimeout(300);
    }
  }
  if (!(await saveAndVerify('Primary Care Provider'))) return out;
  out.saved.primaryCareProvider = true;

  // 8d — Family History. If the radios are DOM-disabled (locked for the sales
  // role) → SKIP the section entirely (no Save): it is not required for Submit.
  if (!(await clickSection('Family History'))) { out.error = 'Family History did not open'; return out; }
  const fam = CFG.family_history.has_family_medical_history; // "Yes" | "No"
  const radio = page.locator('input[name*="family_history_confirm_has_family"][value="' + fam + '"]');
  if (await radio.first().isDisabled().catch(() => true)) {
    out.saved.familyHistory = 'skipped (locked)';
  } else {
    await radio.first().check({ force: true });
    out.familyAnswerSet = true;
    if (!(await saveAndVerify('Family History'))) return out;
    out.saved.familyHistory = true;
  }

  out.ok = true;
  return out;
}
