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
      await jsClickSwal(['OK']);
      if (await until(() => sectionOpen(name), 4000)) return true;
    }
    return false;
  };
  // ---- STUCK "Loading… ⟳" SECTION BODY (user-reported 2026-08-07) ----
  // The heading renders immediately; the body is a separate async mount that can
  // hang on "Loading... ⟳" forever, so every input poll reads an EMPTY form.
  // Waiting longer does NOT help — BOUNCE to another section for ~1s and come
  // back; the remount loads instantly.
  const bodyReady = () => page.evaluate(() => {
    if (/Loading\.\.\./.test(document.body.innerText)) return false;
    const form = [...document.querySelectorAll('.formio-form')]
      .find((f) => f.offsetParent && f.querySelectorAll('input, select, textarea').length);
    return !!form;
  });
  const openSection = async (name, bounceTo) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await clickSection(name))) continue;
      if (await until(bodyReady, 2500, 150)) return true;
      await clickSection(bounceTo);
      await page.waitForTimeout(1000);
    }
    return false;
  };
  // A visible heading does NOT mean the form finished rendering: Form.io mounts
  // its question groups progressively. Planning too early scanned only 5 of the
  // 15 Compliance radio groups, so Save failed validation on the 10 unanswered
  // ones (hit 2026-07-31). Wait until the visible radio count stops changing.
  const waitRadiosSettled = async (timeoutMs = 10000) => {
    let last = -1, stable = 0;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const n = await page.evaluate(() =>
        [...document.querySelectorAll('input[type="radio"]')].filter(r => r.offsetParent).length);
      if (n > 0 && n === last) {
        if (++stable >= 2) return n;      // same count 3 samples in a row
      } else {
        stable = 0; last = n;
      }
      await page.waitForTimeout(250);
    }
    return last;
  };

  const saveAndVerify = async (name) => {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
        .filter((b) => b.textContent.trim() === 'Save' && !b.disabled && b.offsetParent);
      btns[btns.length - 1]?.click();
    });
    // race the confirm dialog against the log — a dialog-less save must not
    // burn a fixed 3s here
    await until(async () => (await jsClickSwal(['Yes']))
      || page.evaluate((n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText)
        || /updated the case from[\s\S]{0,10}New[\s\S]{0,10}to[\s\S]{0,10}Pending/.test(document.body.innerText), name),
      1500, 100);
    // Success signals: activity log shows this section as latest update, OR
    // (Compliance only) the auto status-transition log "from New to Pending" —
    // saving a complete Compliance flips the case immediately and that status
    // log REPLACES the section log (false negative otherwise).
    // Third accepted proof: a GREEN sidebar marker (circle fill #227110). The
    // activity panel shows only ONE latest entry, so a no-op re-save of an
    // already-complete section logs nothing and log-only checking reports a
    // false failure (hit 2026-07-30). NB `gk-section-valid-icon` is the ERROR icon.
    const confirmed = await until(async () =>
      (await page.evaluate((n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText)
        || /updated the case from[\s\S]{0,10}New[\s\S]{0,10}to[\s\S]{0,10}Pending/.test(document.body.innerText), name))
      || (await page.evaluate((n) => {
        const s = [...document.querySelectorAll('.card-header strong')].filter(e => e.textContent.trim() === n).pop();
        return !!s && /#227110/.test(s.parentElement.outerHTML);
      }, name)), 12000, 250);
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
    const res = { answered: [], skippedDisabled: [], unmatched: [], overrideFailures: [], plan: [] };
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
        // PLAN ONLY — do not click here. See applyPlan(): a JS el.click() flips
        // the DOM property without registering with Form.io, so every answer
        // REVERTS on the next re-render. On 2026-07-30 all 15 Compliance radios
        // read back `checked: true`, then Save wiped them and validation
        // reported "This field is required" for every single one.
        res.plan.push({ name: t.name, value: t.value, q: q.slice(0, 60), isOverride });
      } else {
        res.unmatched.push(q.slice(0, 80) + ' (wanted: ' + answer + ')');
        if (isOverride) res.overrideFailures.push({ q: q.slice(0, 80), want: answer });
      }
    }
    return res;
  }, cfg);

  // Trusted click + read-back + retry. The ONLY reliable way to set a Form.io
  // input in this app (see the comment above). `force` because the real <input>
  // sits under a styled label, short per-attempt timeout so retries stay cheap.
  // Three ways to land the click, tried in order of reliability. The app mixes
  // Form.io inputs with app-custom ones (e.g. name="taking-medications", which
  // has NO id at all), so no single strategy covers every question.
  const setInput = async (selector, timeoutMs = 8000) => {
    const loc = page.locator(selector).first();
    const isSet = () => loc.evaluate((el) => !!el.checked).catch(() => false);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await isSet()) return true;
      await loc.click({ force: true, timeout: 1500 }).catch(() => {});     // 1. the input itself
      if (await isSet()) return true;
      const lbl = loc.locator('xpath=ancestor::label[1]');                 // 2. its wrapping label
      if (await lbl.count()) {
        await lbl.first().click({ force: true, timeout: 1500 }).catch(() => {});
        if (await isSet()) return true;
      }
      await page.evaluate((s) => document.querySelector(s)?.click(), selector).catch(() => {}); // 3. last resort
      if (await isSet()) return true;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(150);
    }
  };
  const q = (s) => String(s).replace(/"/g, '\\"');
  // execute a plan built by answerRadios(); returns the same shape the caller expects
  const applyPlan = async (res) => {
    for (const item of res.plan) {
      let ok = await setInput('input[type="radio"][name="' + q(item.name) + '"][value="' + q(item.value) + '"]');
      if (!ok) {
        // Saving Compliance auto-flips the case New → Pending, and that status
        // change re-renders the whole case view — clicks aimed at the previous
        // render land on detached nodes (both Medications radios failed this way
        // on 2026-07-30). Let the re-render finish, then try once more.
        await until(() => page.evaluate((n) => [...document.querySelectorAll('input[type="radio"]')]
          .some(r => r.name === n && r.offsetParent), item.name), 6000);
        ok = await setInput('input[type="radio"][name="' + q(item.name) + '"][value="' + q(item.value) + '"]');
      }
      res.answered.push({ q: item.q, a: item.value, ok });
      if (!ok && item.isOverride) res.overrideFailures.push({ q: item.q, want: item.value });
      if (!ok) res.setFailures = (res.setFailures || []).concat([item.q]);
    }
    delete res.plan;
    return res;
  };
  // tick checkboxes by NAME with trusted clicks; names come from a DOM scan
  const tickCheckboxes = async (names) => {
    const ticked = [], failed = [];
    for (const n of names) {
      const ok = await setInput('input[type="checkbox"][name="' + q(n) + '"]');
      (ok ? ticked : failed).push(n.slice(0, 60));
    }
    return { ticked, failed };
  };

  // ---- Compliance ----
  if (!(await openSection('Compliance', 'Medications'))) { out.error = 'Compliance body stuck on "Loading…" after 3 bounce attempts'; return out; }
  out.radiosSettled = await waitRadiosSettled();
  out.sections.compliance = await applyPlan(await answerRadios(CFG.compliance));
  if (out.sections.compliance.overrideFailures.length || out.sections.compliance.setFailures) {
    out.error = 'Compliance answers did not take effect — NOT saved';
    await page.screenshot({ path: './pss-compliance-mismatch.jpeg', type: 'jpeg', quality: 90 });
    return out;
  }
  // "Reason for audio-only" renders only after Audio Only is picked — poll for it
  await until(() => page.evaluate(() => [...document.querySelectorAll('.formio-component-select')]
    .some(c => c.offsetParent && /audio-only|audio only/i.test(c.textContent))), 5000);
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
    // root MUST be the visible .formio-form that actually CONTAINS checkboxes:
    // several EMPTY .formio-form wrappers are visible at once, and picking the
    // first one silently ticks nothing → the required "Verified Patient
    // Gender/DOB/Address/Phone" boxes stay empty and Save fails validation
    // (learned 2026-07-27: same quirk as the radio root, was missing here).
    // scan for the names first, then tick each with a TRUSTED click (a JS click
    // does not register with Form.io — same revert bug as the radios)
    const boxNames = await page.evaluate(() => {
      const root = [...document.querySelectorAll('.formio-form')]
        .find((f) => f.offsetParent && f.querySelectorAll('input[type="checkbox"]').length) || document;
      return [...root.querySelectorAll('input[type="checkbox"]')]
        .filter((c) => c.offsetParent && !c.disabled && !c.checked).map((c) => c.name);
    });
    const res = await tickCheckboxes(boxNames);
    out.sections.compliance.checkboxes = {
      ticked: res.ticked,
      remaining: res.failed.concat(await page.evaluate(() => {
        const root = [...document.querySelectorAll('.formio-form')]
          .find((f) => f.offsetParent && f.querySelectorAll('input[type="checkbox"]').length) || document;
        return [...root.querySelectorAll('input[type="checkbox"]')]
          .filter((c) => c.offsetParent && !c.disabled && !c.checked).map((c) => c.name.slice(0, 60));
      }))
    };
    if (out.sections.compliance.checkboxes.remaining.length) {
      out.error = 'Required Compliance checkboxes still unchecked — NOT saved';
      await page.screenshot({ path: './pss-compliance-checkbox-fail.jpeg', type: 'jpeg', quality: 90 });
      return out;
    }
  }
  if (!(await saveAndVerify('Compliance'))) return out;
  out.sections.compliance.saved = true;

  // ---- Medications ----
  if (!(await openSection('Medications', 'Compliance'))) { out.error = 'Medications body stuck on "Loading…" after 3 bounce attempts'; return out; }
  await waitRadiosSettled();
  out.sections.medications = await applyPlan(await answerRadios(CFG.medications));
  if (out.sections.medications.overrideFailures.length || out.sections.medications.setFailures) {
    out.error = 'Medications answers did not take effect — NOT saved';
    await page.screenshot({ path: './pss-medications-mismatch.jpeg', type: 'jpeg', quality: 90 });
    return out;
  }
  if (CFG.medications.confirm_checkbox_contains) {
    // the Medications confirm box (name="admin-pss-confirm") is an app-custom
    // checkbox OUTSIDE any .formio-form → find it by label text, then TRUSTED click
    const confirmName = await page.evaluate((txt) => {
      for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
        if (!cb.offsetParent || cb.disabled) continue;
        const comp = cb.closest('.formio-component') || cb.parentElement;
        if ((comp?.textContent || '').includes(txt)) return cb.name;
      }
      return null;
    }, CFG.medications.confirm_checkbox_contains);
    out.sections.medications.confirm = !confirmName ? 'not found'
      : (await tickCheckboxes([confirmName])).ticked.length ? 'checked' : 'click-failed';
    if (out.sections.medications.confirm === 'click-failed') {
      out.error = 'Medications confirm checkbox never became checked — NOT saved';
      return out;
    }
  }
  if (!(await saveAndVerify('Medications'))) return out;
  out.sections.medications.saved = true;

  // ---- other sections: skipped by design (already done by SALES or optional) ----
  out.sections.skipped = ['Patient Information', 'Opt-In Consent', 'Primary Care Provider', 'Medical History', 'Family History'];

  out.ok = true;
  return out;
}
