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

  // SPEED RULE: poll for what you need, never sleep a fixed amount.
  const until = async (fn, timeoutMs = 6000, everyMs = 120) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn().catch(() => false);
      if (v) return v;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(everyMs);
    }
  };
  const sectionOpen = (name) => page.evaluate((n) => {
    const h = [...document.querySelectorAll('h1,h2,h3')].find((e) => e.textContent.trim() === n);
    return !!(h && h.offsetParent);
  }, name);
  const clickSection = async (name) => {
    if (await sectionOpen(name)) return true;
    for (let i = 0; i < 3; i++) {
      await page.evaluate((n) => {
        const es = [...document.querySelectorAll('strong')].filter((s) => s.textContent.trim() === n);
        es[es.length - 1]?.click();
      }, name);
      await jsClickSwal(['OK']); // unsaved-data navigation guard
      if (await until(() => sectionOpen(name), 4000)) return true;
    }
    return false;
  };
  // ---- STUCK "Loading… ⟳" SECTION BODY (user-reported 2026-08-07) ----
  // The section HEADING renders immediately, but the body is a separate async
  // mount that shows "Loading... ⟳" — and it can hang there forever. Every
  // input-level poll then reads an EMPTY form: on 2026-08-07 fast-02 aborted
  // with `Opt-In answer mismatch — got: []` because not one radio existed.
  // Waiting longer does NOT help. The fix is to BOUNCE: click another section,
  // wait ~1s, click back — the remount loads instantly.
  const SECTIONS = ['Patient Information', 'Opt-In Consent', 'Primary Care Provider', 'Family History'];
  const bodyReady = () => page.evaluate(() => {
    if (/Loading\.\.\./.test(document.body.innerText)) return false;
    const form = [...document.querySelectorAll('.formio-form')]
      .find((f) => f.offsetParent && f.querySelectorAll('input, select, textarea').length);
    return !!form;
  });
  // Open a section AND wait for its body to actually mount. `probe` (optional)
  // is a selector that must exist once the section is really ready.
  const openSection = async (name, probe) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await clickSection(name))) continue;
      const ready = await until(async () =>
        (await bodyReady()) && (!probe || (await page.locator(probe).count()) > 0), 2500, 150);
      if (ready) return true;
      // still "Loading…" after 2.5s → bounce off a neighbour for 1s and retry
      const other = SECTIONS.find((s) => s !== name);
      await clickSection(other);
      await page.waitForTimeout(1000);
    }
    return false;
  };
  // Setting a Form.io input has TWO failure modes, and the fix needs both halves:
  //  - Too early: the heading is visible but Form.io has not hydrated yet, so
  //    `.check()` throws "Clicking the checkbox did not change its state".
  //  - Wrong kind of click: a JS `el.click()` flips the DOM property but Form.io
  //    never registers it, so the value REVERTS on the next re-render (this is
  //    what silently unchecked the PCP box on 2026-07-30 and left the reason
  //    dropdown unrendered → a 30s locator timeout).
  // So: TRUSTED click (force, short timeout), then read the value back, retry
  // until it sticks. Never swap this for a JS click.
  //  - Invisible input (hit on PROD 2026-08-12): the real <input> is styled
  //    `opacity: 0` under a custom label, and clicking the INPUT silently does
  //    nothing — every retry no-ops until the deadline, then `got: []` aborts
  //    the run ("Opt-In answer mismatch before save"). Clicking the WRAPPING
  //    LABEL registers immediately. Same 3-strategy ladder as pss-02.
  const setInput = async (selector, timeoutMs = 8000) => {
    const loc = page.locator(selector).first();
    const isSet = () => loc.evaluate((el) => !!el.checked).catch(() => false);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await isSet()) return true;
      await loc.click({ force: true, timeout: 1500 }).catch(() => {});      // 1. the input itself
      if (await isSet()) return true;
      const lbl = loc.locator('xpath=ancestor::label[1]');                  // 2. its wrapping label
      if (await lbl.count()) {
        await lbl.first().click({ force: true, timeout: 1500 }).catch(() => {});
        if (await isSet()) return true;
      }
      await page.evaluate((s) => document.querySelector(s)?.click(), selector).catch(() => {}); // 3. last resort
      if (await isSet()) return true;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(200);
    }
  };
  const setRadio = (namePart, value, timeoutMs = 8000) =>
    setInput('input[name*="' + namePart + '"][value="' + value + '"]', timeoutMs);
  const setCheckbox = (namePart, timeoutMs = 8000) =>
    setInput('input[type="checkbox"][name*="' + namePart + '"]', timeoutMs);

  // Save the ACTIVE section and verify via the activity log; abort on failure.
  const saveAndVerify = async (name) => {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
        .filter((b) => b.textContent.trim() === 'Save' && !b.disabled && b.offsetParent);
      btns[btns.length - 1]?.click();
    });
    // A confirm dialog may appear late, but most saves show none — race it
    // against the activity log so a dialog-less save does not burn a fixed 3s.
    await until(async () => (await jsClickSwal(['Yes']))
      || page.evaluate((n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText), name),
      1500, 100);
    // Hard verification, two accepted proofs:
    //  a) the activity log names this section, or
    //  b) the section's sidebar marker is GREEN (circle fill #227110).
    // (b) is required because the activity panel shows only the ONE latest
    // entry: re-running the script over an already-saved section produces a
    // no-op save with no new log line, and log-only checking then reports a
    // false "Save NOT confirmed" (hit 2026-07-30 on a resumed run).
    const confirmed = await until(async () =>
      (await page.evaluate((n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText), name))
      || (await page.evaluate((n) => {
        const s = [...document.querySelectorAll('.card-header strong')].filter(e => e.textContent.trim() === n).pop();
        return !!s && /#227110/.test(s.parentElement.outerHTML);
      }, name)), 12000, 250);
    if (!confirmed) {
      out.error = 'Save NOT confirmed by activity log'; out.failedSection = name;
      await page.screenshot({ path: './fast-section-save-failed.jpeg', type: 'jpeg', quality: 90 });
    }
    return confirmed;
  };

  // 8a — Patient Information (pre-filled by the create wizard, just Save)
  if (!(await openSection('Patient Information'))) { out.error = 'Patient Information body stuck on "Loading…" after 3 bounce attempts'; return out; }
  if (!(await saveAndVerify('Patient Information'))) return out;
  out.saved.patientInformation = true;

  // 8b — Opt-In Consent
  if (!(await openSection('Opt-In Consent', 'input[name*="opt_in_consent_q1"]'))) { out.error = 'Opt-In Consent body stuck on "Loading…" after 3 bounce attempts'; return out; }
  const perm = CFG.opt_in_consent.permission_to_speak_with_provider; // "Yes" | "No"
  const q1 = page.locator('input[name*="opt_in_consent_q1"][value="' + perm + '"]');
  if (await q1.first().isDisabled().catch(() => true)) {
    out.optInLocked = true; // already recorded/locked — do NOT force
  } else {
    await setRadio('opt_in_consent_q1', perm);
    await setRadio('opt_in_consent_proof_method', CFG.opt_in_consent.consent_proof_method);
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
  if (!(await openSection('Primary Care Provider', 'input[type="checkbox"][name*="pcp_no_pcp_certification"]'))) { out.error = 'Primary Care Provider body stuck on "Loading…" after 3 bounce attempts'; return out; }
  if (CFG.primary_care_provider.pcp_information_unavailable) {
    if (!(await setCheckbox('pcp_no_pcp_certification'))) {
      out.error = 'PCP-unavailable checkbox never became checked'; return out;
    }
    // the reason dropdown only renders after the box is ticked
    await until(() => page.evaluate(() => !!document.querySelector('[id*="pcp_no_pcp_reason"]')), 4000);
    const reasonSelected = await page.evaluate(() => {
      const sel = document.querySelector('[id*="pcp_no_pcp_reason"]');
      return !!sel?.closest('.choices')?.querySelector('.choices__list--single .choices__item');
    });
    if (!reasonSelected) {
      await page.locator('.choices').filter({ has: page.locator('[id*="pcp_no_pcp_reason"]') })
        .first().click({ timeout: 8000 });
      await page.locator('.choices__list--dropdown [role="option"]')
        .filter({ hasText: CFG.primary_care_provider.reason_for_missing_info }).first().click({ timeout: 8000 });
      await until(() => page.evaluate(() => {
        const sel = document.querySelector('[id*="pcp_no_pcp_reason"]');
        return !!sel?.closest('.choices')?.querySelector('.choices__list--single .choices__item:not(.choices__placeholder)');
      }), 4000);
    }
  }
  if (!(await saveAndVerify('Primary Care Provider'))) return out;
  out.saved.primaryCareProvider = true;

  // 8d — Family History. If the radios are DOM-disabled (locked for the sales
  // role) → SKIP the section entirely (no Save): it is not required for Submit.
  if (!(await openSection('Family History', 'input[name*="family_history_confirm_has_family"]'))) { out.error = 'Family History body stuck on "Loading…" after 3 bounce attempts'; return out; }
  const fam = CFG.family_history.has_family_medical_history; // "Yes" | "No"
  const radio = page.locator('input[name*="family_history_confirm_has_family"][value="' + fam + '"]');
  if (await radio.first().isDisabled().catch(() => true)) {
    out.saved.familyHistory = 'skipped (locked)';
  } else {
    out.familyAnswerSet = await setRadio('family_history_confirm_has_family', fam);
    if (!out.familyAnswerSet) { out.error = 'Family History radio never took the value ' + fam; return out; }
    if (!(await saveAndVerify('Family History'))) return out;
    out.saved.familyHistory = true;
  }

  out.ok = true;
  return out;
}
