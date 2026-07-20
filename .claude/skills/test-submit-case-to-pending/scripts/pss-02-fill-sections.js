// pss-02: walk the case sidebar sections; fill + Save ONLY Compliance and
// Medications from CFG; every other section (and any disabled question) is
// skipped. Each save is verified against the activity log.
// Run via mcp__playwright__browser_run_code_unsafe: Read this file, replace
// __CONFIG__ with the `compliance` + `medications` objects from pss-data.json.
//
// Inherits the DNA Insights landmine rules (see test-create-new-case SKILL.md):
// visible-Save only, JS-click + poll swal, Form.io radios by input value,
// disabled inputs → skip, "unsaved data" guard → OK.
async (page) => {
  const CFG = __CONFIG__;
  const out = { stage: 'pss-fill-sections', sections: {}, ok: false };

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
      await jsClickSwal(['OK']);
      const opened = await page.evaluate((n) => {
        const h = [...document.querySelectorAll('h1,h2,h3')].find((e) => e.textContent.trim() === n);
        return !!(h && h.offsetParent);
      }, name);
      if (opened) return true;
    }
    return false;
  };

  const saveAndVerify = async (name) => {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
        .filter((b) => b.textContent.trim() === 'Save' && !b.disabled && b.offsetParent);
      btns[btns.length - 1]?.click();
    });
    for (let t = 0; t < 6; t++) {
      if (await jsClickSwal(['Yes'])) break;
      await page.waitForTimeout(500);
    }
    // Success signals: activity log shows this section as latest update, OR
    // (Compliance only) the auto status-transition log "from New to Pending" —
    // saving a complete Compliance flips the case immediately and that status
    // log REPLACES the section log (false negative otherwise).
    const confirmed = await page.waitForFunction(
      (n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText)
        || /updated the case from[\s\S]{0,10}New[\s\S]{0,10}to[\s\S]{0,10}Pending/.test(document.body.innerText),
      name, { timeout: 12000 }
    ).then(() => true).catch(() => false);
    if (!confirmed) {
      out.error = 'Save NOT confirmed by activity log'; out.failedSection = name;
      await page.screenshot({ path: './pss-section-save-failed.jpeg', type: 'jpeg', quality: 90 });
    }
    return confirmed;
  };

  // Answer every ENABLED radio group per config; disabled → skip.
  // Scoped to the ACTIVE section's visible .formio-form so we never touch
  // inputs elsewhere on the page. Each click is read back (`ok`) — an
  // override that didn't take effect is a hard failure (wrong-save guard).
  const answerRadios = (cfg) => page.evaluate((c) => {
    // root: the visible .formio-form that CONTAINS radios (several empty
    // wrapper forms can be visible at once). Some questions are app-custom
    // radios OUTSIDE any .formio-form (e.g. name="taking-medications") →
    // scan document-wide but only visible+enabled inputs.
    const root = [...document.querySelectorAll('.formio-form')]
      .find((f) => f.offsetParent && f.querySelectorAll('input[type="radio"]').length) || document;
    const qOf = (r) => {
      const comp = r.closest('.formio-component') || r.closest('[class*="form-group"]');
      if (comp) {
        const lbl = comp.querySelector('label');
        return ((lbl?.textContent || comp.textContent || '').trim()).slice(0, 140);
      }
      // app-custom radio: climb until the wrapper's text includes a question mark
      let p = r.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        const t = (p.textContent || '').trim();
        if (t.includes('?')) return t.slice(0, 140);
        p = p.parentElement;
      }
      return (r.name || '').slice(0, 140);
    };
    const res = { answered: [], skippedDisabled: [], unmatched: [], overrideFailures: [] };
    const groups = {};
    const scope = root === document ? document : null;
    const radioEls = [...root.querySelectorAll('input[type="radio"]'),
      ...(!scope ? [...document.querySelectorAll('input[type="radio"]')].filter(r => !r.closest('.formio-form')) : [])];
    for (const r of radioEls) {
      if (!r.offsetParent) continue;
      (groups[r.name] = groups[r.name] || []).push(r);
    }
    for (const rs of Object.values(groups)) {
      const q = qOf(rs[0]);
      if (rs.every((x) => x.disabled)) { res.skippedDisabled.push(q.slice(0, 80)); continue; }
      let answer = c.default_answer || null;
      let isOverride = false;
      for (const o of (c.overrides || [])) {
        if (q.toLowerCase().includes(o.question_contains.toLowerCase())) { answer = o.answer; isOverride = true; }
      }
      if (!answer) continue; // no rule for this question → leave untouched
      const t = rs.find((x) => !x.disabled && x.value.toLowerCase() === answer.toLowerCase())
        || rs.find((x) => !x.disabled && x.value.toLowerCase().includes(answer.toLowerCase()));
      if (t) {
        if (!t.checked) t.click();
        const ok = t.checked; // read back immediately
        res.answered.push({ q: q.slice(0, 60), a: t.value, ok });
        if (isOverride && !ok) res.overrideFailures.push({ q: q.slice(0, 80), want: answer });
      } else {
        res.unmatched.push(q.slice(0, 80) + ' (wanted: ' + answer + ')');
        if (isOverride) res.overrideFailures.push({ q: q.slice(0, 80), want: answer });
      }
    }
    return res;
  }, cfg);

  // ---- Compliance ----
  if (!(await clickSection('Compliance'))) { out.error = 'Compliance section did not open'; return out; }
  out.sections.compliance = await answerRadios(CFG.compliance);
  if (out.sections.compliance.overrideFailures.length) {
    out.error = 'Compliance override answers did not take effect — NOT saved';
    await page.screenshot({ path: './pss-compliance-mismatch.jpeg', type: 'jpeg', quality: 90 });
    return out;
  }
  await page.waitForTimeout(800); // "Reason for audio-only" renders after Audio Only is picked
  // reason dropdown: try Choices.js UI, then native <select>
  let reasonSet = null;
  // the reason field is a .formio-component-select whose Choices options LAZY-LOAD
  const reasonCombo = page.locator('.formio-component-select').filter({ hasText: 'Reason for audio-only' }).locator('.choices').first();
  if (await reasonCombo.count()) {
    await reasonCombo.click();
    const opt = page.locator('.choices__list--dropdown [role="option"]').filter({ hasText: CFG.compliance.reason_for_audio_only }).first();
    const optVisible = await opt.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (optVisible) { await opt.click(); reasonSet = 'choices'; }
  }
  if (!reasonSet) {
    reasonSet = await page.evaluate((reason) => {
      for (const sel of document.querySelectorAll('select')) {
        const comp = sel.closest('.formio-component');
        if (!comp || !/audio-only|audio only/i.test(comp.textContent)) continue;
        const opt = [...sel.options].find((o) => o.textContent.trim().toLowerCase().includes(reason.toLowerCase()));
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return 'select'; }
      }
      return null;
    }, CFG.compliance.reason_for_audio_only);
  }
  out.sections.compliance.reasonSet = reasonSet; // may be null if field pre-filled/absent
  if (CFG.compliance.check_all_verification_checkboxes) {
    out.sections.compliance.checkboxes = await page.evaluate(() => {
      const root = [...document.querySelectorAll('.formio-form')].find((f) => f.offsetParent) || document;
      let n = 0;
      for (const cb of root.querySelectorAll('input[type="checkbox"]')) {
        if (cb.offsetParent && !cb.disabled && !cb.checked) { cb.click(); n++; }
      }
      return n + ' checked';
    });
  }
  if (!(await saveAndVerify('Compliance'))) return out;
  out.sections.compliance.saved = true;

  // ---- Medications ----
  if (!(await clickSection('Medications'))) { out.error = 'Medications section did not open'; return out; }
  out.sections.medications = await answerRadios(CFG.medications);
  if (out.sections.medications.overrideFailures.length) {
    out.error = 'Medications answers did not take effect — NOT saved';
    await page.screenshot({ path: './pss-medications-mismatch.jpeg', type: 'jpeg', quality: 90 });
    return out;
  }
  if (CFG.medications.confirm_checkbox_contains) {
    out.sections.medications.confirm = await page.evaluate((txt) => {
      const root = [...document.querySelectorAll('.formio-form')].find((f) => f.offsetParent) || document;
      for (const cb of root.querySelectorAll('input[type="checkbox"]')) {
        if (!cb.offsetParent || cb.disabled) continue;
        const comp = cb.closest('.formio-component') || cb.parentElement;
        if ((comp?.textContent || '').includes(txt)) { if (!cb.checked) cb.click(); return 'checked'; }
      }
      return 'not found';
    }, CFG.medications.confirm_checkbox_contains);
  }
  if (!(await saveAndVerify('Medications'))) return out;
  out.sections.medications.saved = true;

  // ---- other sections: skipped by design (already done by SALES or optional) ----
  out.sections.skipped = ['Patient Information', 'Opt-In Consent', 'Primary Care Provider', 'Medical History', 'Family History'];

  out.ok = true;
  return out;
}
