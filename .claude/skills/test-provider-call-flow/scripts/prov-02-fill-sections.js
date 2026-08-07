// prov-02: fill + save ALL provider sections on the open case (provider
// context) using the EXACT field keys from data/captured-keys.json — no
// discovery, no heuristics. No placeholders — run via {filename}.
// Sections: Medications, Medical History, Review of Systems, Family History,
// General Health, Depression Screening, Social History, Preventive Screening,
// Functional Status & Safety, Advance Care Planning, Diagnosis (Z00.01).
async (page) => {
  const provPage = page.context().browser().contexts().find(c => c !== page.context())?.pages()[0];
  if (!provPage) return { ok: false, error: 'no provider context — run prov-01 first' };
  const out = { stage: 'fill-sections', sections: {}, ok: false };
  provPage.removeAllListeners('dialog');
  provPage.on('dialog', d => d.accept().catch(() => {}));

  const norm = (s) => (s || '').replace(/[–—]/g, '-').toLowerCase();
  // SPEED RULE (2026-07-30): never `waitForTimeout` for something observable.
  // The old fixed sleeps cost ~68s of pure waiting across the 11 sections
  // (1.2s open + 0.8s settle + 3s swal poll + 1.2s post-save, every section).
  // `until()` polls fast and returns the moment the condition holds.
  const until = async (fn, timeoutMs = 8000, everyMs = 120) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn().catch(() => false);
      if (v) return v;
      if (Date.now() >= deadline) return false;
      await provPage.waitForTimeout(everyMs);
    }
  };
  const jsClickSwal = (ls) => provPage.evaluate((labels) => {
    const b = [...document.querySelectorAll('.swal-modal button, .swal2-popup button')]
      .find(x => labels.includes(x.textContent.trim()) && x.offsetParent);
    if (b) { b.click(); return true; } return false;
  }, ls);
  const sectionOpen = (name) => provPage.evaluate((n) =>
    !![...document.querySelectorAll('h1,h2,h3')].find(e => e.textContent.trim() === n && e.offsetParent), name);
  const clickHeading = (name) => provPage.evaluate((n) => {
    const es = [...document.querySelectorAll('strong')].filter(s => s.textContent.trim() === n && s.offsetParent);
    es[es.length - 1]?.click();
  }, name);
  // ---- STUCK "Loading… ⟳" SECTION BODY (user-reported 2026-08-07) ----
  // The heading renders immediately; the body is a separate async mount that can
  // hang on "Loading... ⟳" forever, so every input poll reads an EMPTY form and
  // the section is reported as "answers did not take effect". Waiting longer does
  // NOT help — BOUNCE to another sidebar section for ~1s and come back; the
  // remount loads instantly.
  const bodyReady = () => provPage.evaluate(() => {
    if (/Loading\.\.\./.test(document.body.innerText)) return false;
    return !![...document.querySelectorAll('.formio-form')]
      .find(f => f.offsetParent && f.querySelectorAll('input, select, textarea').length);
  });
  const bounceOff = async (name) => {
    const other = await provPage.evaluate((n) => {
      const s = [...document.querySelectorAll('.card-header strong')]
        .map(e => e.textContent.trim()).find(t => t && t !== n);
      return s || null;
    }, name);
    if (!other) return;
    await clickHeading(other);
    await provPage.waitForTimeout(1000);
  };
  const clickSection = async (name) => {
    // the app auto-advances after each Save, so the wanted section is often
    // already on screen — check first, click only if needed.
    for (let attempt = 0; attempt < 3; attempt++) {
      let open = await sectionOpen(name);
      for (let i = 0; i < 3 && !open; i++) {
        await clickHeading(name);
        await jsClickSwal(['OK']); // unsaved-data navigation guard
        open = await until(() => sectionOpen(name), 4000);
      }
      if (!open) return false;
      if (await until(bodyReady, 2500, 150)) return true;
      await bounceOff(name);   // body stuck on "Loading…" → bounce and retry
    }
    return false;
  };
  const saveAndVerify = async (name) => {
    await provPage.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Save' && !b.disabled && b.offsetParent);
      btns[btns.length - 1]?.click();
    });
    // Race the confirm dialog against the activity log: most sections save with
    // no dialog at all, and the old 6×500ms poll burned the full 3s every time.
    await until(async () => (await jsClickSwal(['Yes']))
      || provPage.evaluate((n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText), name),
      1500, 100);
    return provPage.waitForFunction(
      (n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText),
      name, { timeout: 12000 }
    ).then(() => true).catch(() => false);
  };
  // set radios by {namePart: wantedValue}. PLAN in the page, then click from
  // Node with a trusted click + read-back: a JS click does not register with
  // Form.io and reverts on re-render (proven on the PSS Compliance section,
  // where all 15 answers were wiped by Save on 2026-07-30).
  const setRadios = async (map) => {
    const plan = await provPage.evaluate((m) => {
      const nrm = (s) => (s || '').replace(/[–—]/g, '-').toLowerCase();
      const out = [];
      for (const [namePart, want] of Object.entries(m)) {
        const rs = [...document.querySelectorAll('input[type="radio"]')]
          .filter(r => r.offsetParent && !r.disabled && r.name.includes(namePart));
        const t = rs.find(x => nrm(x.value) === nrm(want)) || rs.find(x => nrm(x.value).includes(nrm(want)));
        out.push(t ? { namePart, name: t.name, value: t.value, checked: t.checked }
                   : { namePart, miss: rs.length });
      }
      return out;
    }, map);
    const done = {};
    for (const item of plan) {
      if (item.miss !== undefined) { done[item.namePart] = 'MISS(' + item.miss + ')'; continue; }
      if (item.checked) { done[item.namePart] = item.value; continue; }
      const sel = 'input[type="radio"][name="' + item.name.replace(/"/g, '\\"')
        + '"][value="' + item.value.replace(/"/g, '\\"') + '"]';
      const loc = provPage.locator(sel).first();
      const isSet = () => loc.evaluate(e => !!e.checked).catch(() => false);
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
        await loc.click({ force: true, timeout: 1500 }).catch(() => {});
        ok = await isSet();
        if (!ok) {
          const lbl = loc.locator('xpath=ancestor::label[1]');
          if (await lbl.count()) { await lbl.first().click({ force: true, timeout: 1500 }).catch(() => {}); ok = await isSet(); }
        }
      }
      done[item.namePart] = ok ? item.value : 'SET-FAILED(' + item.value + ')';
    }
    return done;
  };
  const setTextByLabel = (labelPart, value) => provPage.evaluate(([lp, v]) => {
    for (const inp of document.querySelectorAll('textarea, input[type="text"], input[type="number"]')) {
      if (!inp.offsetParent || inp.disabled) continue;
      const lbl = (inp.closest('.formio-component')?.querySelector('label')?.textContent || '');
      if (lbl.toLowerCase().includes(lp.toLowerCase())) {
        const proto = inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, v);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, [labelPart, value]);
  // Ticking a Form.io checkbox needs ALL THREE of these, or it silently fails
  // (2026-07-30 — this one bug cost five repair rounds on CA-QI3GSKRF):
  //  1. scrollIntoView — attestation boxes sit ~1500px down, far outside the
  //     1000px viewport, and a click there lands on nothing.
  //  2. click the LABEL, not the input — the input is `opacity: 0`.
  //  3. verify `.checked` afterwards — a JS `el.click()` flips the property but
  //     Form.io never registers it, so the value REVERTS on the next re-render
  //     (that is how `preventive_exam_statement` came back unchecked after a
  //     "successful" tick and blocked the section's Save).
  const setBoxByComponentId = async (id) => {
    const isSet = () => provPage.evaluate((i) => {
      const cb = document.querySelector('#' + i + ' input[type="checkbox"]');
      return !!cb && cb.checked;
    }, id).catch(() => false);
    if (await isSet()) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      await provPage.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'center' }), id);
      await provPage.waitForTimeout(200);
      await provPage.locator('#' + id + ' label.form-check-label').first().click({ timeout: 3000 }).catch(() => {});
      if (await isSet()) return true;
      await provPage.locator('#' + id + ' input[type="checkbox"]').first()
        .click({ force: true, timeout: 2000 }).catch(() => {});
      if (await isSet()) return true;
    }
    return false;
  };
  // collect matching checkbox components (by label text, or all of them), then
  // tick each through setBoxByComponentId
  const tickBoxes = async (re) => {
    const targets = await provPage.evaluate((pattern) => [...document.querySelectorAll('.formio-component-checkbox')]
      .filter(c => {
        const cb = c.querySelector('input[type="checkbox"]');
        if (!cb || cb.disabled || cb.checked || !c.id) return false;
        if (!pattern) return true;
        return new RegExp(pattern, 'i').test(c.textContent || '');
      })
      .map(c => c.id), re || null);
    const res = {};
    for (const id of targets) res[id] = await setBoxByComponentId(id);
    return res;
  };
  const checkBoxesByText = (txt) => tickBoxes(txt);
  const checkAllBoxes = () => tickBoxes(null);
  // Completeness = the SIDEBAR marker of that very section, read from the row's
  // own markup. Two traps here (both hit 2026-07-30):
  // - The activity log confirms a save even when the section stays INCOMPLETE,
  //   so the log alone is not proof (already known from 2026-07-27).
  // - Scanning the ACTIVE form after Save is off by one: the app AUTO-ADVANCES
  //   to the next section, so the scan reported the *next* section's empty
  //   fields and every section looked "saved-INCOMPLETE" for no reason.
  // - `svg.gk-section-valid-icon` is misnamed: it wraps `id="icon-error"` and
  //   marks the RED ASTERISK (incomplete). A COMPLETE section renders a green
  //   circle `fill="#227110"`.
  // Scope to `.card-header strong`: a bare `strong` scan matches other nodes on
  // the page and `.pop()` then reads the wrong one — that is why prov-02 called
  // Review of Systems "saved" while the sidebar showed a red * (2026-07-30).
  const sectionState = (name) => provPage.evaluate((n) => {
    const s = [...document.querySelectorAll('.card-header strong')].filter(e => e.textContent.trim() === n).pop();
    if (!s) return 'not-found';
    const html = s.parentElement.outerHTML;
    if (/#227110/.test(html)) return 'complete';
    if (/gk-section-valid-icon/.test(html)) return 'INCOMPLETE';
    return 'no-marker';
  }, name);
  // Required-but-empty labels of the section currently on screen — diagnostics
  // only, call it BEFORE Save (after Save the app has already moved on).
  const unfilledRequired = () => provPage.evaluate(() => {
    const form = [...document.querySelectorAll('.formio-form')]
      .find(f => f.offsetParent && f.querySelectorAll('.formio-component').length > 3) || document;
    const miss = [];
    for (const c of form.querySelectorAll('.formio-component')) {
      if (!c.offsetParent) continue;
      const lbl = c.querySelector('label');
      if (!lbl || !/\*/.test(lbl.textContent)) continue;
      const inputs = [...c.querySelectorAll('input, textarea, select')];
      const filled = inputs.some(i => (i.type === 'radio' || i.type === 'checkbox')
        ? i.checked : (i.value || '').trim().length > 0);
      if (!filled) miss.push(lbl.textContent.trim().replace(/\s+/g, ' ').slice(0, 70));
    }
    return miss;
  });

  const doSection = async (name, fill) => {
    if (!(await clickSection(name))) { out.sections[name] = 'did not open'; return; }
    // wait for the section's form to actually have inputs instead of sleeping
    await until(() => provPage.evaluate(() => !![...document.querySelectorAll('.formio-form')]
      .find(f => f.offsetParent && f.querySelectorAll('input, textarea, select').length)), 5000);
    await fill();
    const missBefore = await unfilledRequired();
    const logged = await saveAndVerify(name);
    const state = await until(async () => {
      const s = await sectionState(name);
      return s === 'complete' ? s : false;             // give the marker a moment to repaint
    }, 2500) || await sectionState(name);
    out.sections[name] = state === 'complete' ? 'saved'
      : !logged ? 'save-unconfirmed'
      : 'saved-' + state + (missBefore.length ? ': ' + missBefore.join(' | ') : '');
  };

  await doSection('Medications', async () => {
    await setRadios({ 'taking-medications': 'No', 'has_allergi': 'No' });
    await checkBoxesByText('I confirm that I have verified');
  });
  await doSection('Medical History', async () => {
    await setTextByLabel('Past Medical History', 'Hypertension, well controlled with lifestyle modification. No prior surgeries. No hospitalizations in the past year.');
    await checkBoxesByText('I have checked this section');
  });
  await doSection('Review of Systems', async () => {
    await setTextByLabel('Review of Systems Notes', 'Patient denies all symptoms reviewed by systems.');
    // The blocking required field is the attestation box
    // (data[review_of_system_confirm], label "I affirm that i have verified…") —
    // NOT "I have checked this section", which does not exist here. The 10
    // body-system groups render a * but do NOT block completion, so no symptom
    // is fabricated; only the negative finding "No Lesions" is ticked.
    // Tick it BY NAME with a trusted check: checkBoxesByText() matched nothing
    // because `cb.closest('.formio-component, label, div')` resolves to the
    // innermost wrapper DIV, which does not contain the label text (2026-07-30
    // — ROS silently stayed incomplete for a whole run because of this).
    const rosConfirm = provPage.locator('input[name="data[review_of_system_confirm]"]').first();
    if (await rosConfirm.count()) await rosConfirm.check({ force: true }).catch(() => {});
    await provPage.evaluate(() => {
      for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
        if (cb.offsetParent && !cb.disabled && !cb.checked && cb.value === 'No Lesions') cb.click();
      }
    });
  });
  // Family History → answer **No**, which matches what the SALES side already
  // saved for this patient (case-data.json family_history: "No") and completes
  // the section in one radio click.
  // Do NOT answer Yes: the form now renders FIVE member blocks and Condition
  // (2)–(5) are all required, so one fabricated "Mother / Cancer" member leaves
  // the section permanently incomplete (2026-07-30). The old Yes-path code is
  // gone on purpose — re-adding it re-breaks the section.
  await doSection('Family History', async () => {
    await setRadios({ 'family_history_confirm_has_family': 'No' });
    await until(() => checkBoxesByText('confirm|affirm|checked this section'), 2000, 100);
  });
  await doSection('General Health', async () => {
    await setRadios({
      general_health_describes_your_current_living_arrangement: 'Single',
      general_health_how_would_you_rate_your_overall_health: 'Good',
      general_health_hospitalized: 'No',
      health_behaviors_special_diet: 'No',
      health_behaviors_current_weight: 'Yes',
      health_behaviors_food_worry: 'No',
      health_behaviors_food_run_out: 'No',
      health_behaviors_usually_exercise: '1-2 times',
      health_behaviors_typical_exercise: 'Light',
      health_behaviors_sleep_time: '5-8 hours',
      general_health_stress_problem: 'Sometimes',
      general_health_stress_in_your_life: 'usually able to cope',
      general_health_stress_social_and_emotional_support: 'Usually',
      general_health_stress_satisfied_in_your_life: 'Satisfied',
      general_health_bodily_pain: '0 - No pain'
    });
    await setTextByLabel('how long do you usually exercise', '30 minutes');
    await checkAllBoxes();
  });
  await doSection('Depression Screening', async () => {
    await setRadios({
      test_requirements_depression_screening_things_phq2: '0',
      test_requirements_depression_screening_hopeless_phq2: '0',
      test_requirements_depression_screening_ongoing_phq2: 'Yes',
      test_requirements_depression_screening_problem_functioning: 'Not difficult'
    });
    await provPage.evaluate(() => { // PHQ-9 rows all 0
      for (const r of document.querySelectorAll('input[type="radio"]')) {
        if (r.offsetParent && !r.disabled && /depression_screening_things_phq9/.test(r.name) && r.value === '0' && !r.checked) r.click();
      }
    });
    await checkAllBoxes();
  });
  await doSection('Social History', async () => {
    await setRadios({ social_history_screening_alcohol: 'No', social_history_screening_smoke: 'No', social_history_screening_drugs: 'No' });
    await checkAllBoxes();
  });
  await doSection('Preventive Screening and Immunization', async () => {
    await provPage.evaluate(() => { // grid statuses are lowercase yes/no
      for (const r of document.querySelectorAll('input[type="radio"]')) {
        if (r.offsetParent && !r.disabled && /preventive_past_(exam|immunization)/.test(r.name) && r.value === 'no' && !r.checked) r.click();
      }
    });
    await checkAllBoxes();
  });
  await doSection('Functional Status & Safety', async () => {
    await provPage.evaluate(() => {
      for (const r of document.querySelectorAll('input[type="radio"]')) {
        if (!r.offsetParent || r.disabled) continue;
        if (/screening_adls\[\d+\]\[assistance\]/.test(r.name) && r.value === 'no' && !r.checked) r.click();
        if (/screening_IADL/.test(r.name) && r.value === 'no_help' && !r.checked) r.click();
      }
    });
    await setRadios({
      functional_safety_adls_radio_statement: 'adequate support',
      functional_safety_screening_any_falls: 'No',
      functional_safety_screening_afraid_falling: 'No',
      functional_safety_screening_assistive_devices: 'None',
      functional_safety_screening_feel_housing_type: 'Home',
      functional_safety_screening_feel_utility_problems: 'No',
      functional_safety_screening_grab_bars1: 'Yes',
      functional_safety_screening_feel_safe_h: 'Yes',
      functional_safety_screening_safety_feel_safe: 'Yes',
      functional_safety_screening_safety_physical_abuse: 'No',
      functional_safety_screening_safety_emotional_abuse: 'No',
      functional_safety_screening_difficulties_drive: 'Yes',
      functional_safety_screening_grab_bars: 'Yes',
      functional_safety_screening_ever_driving: 'No',
      functional_safety_screening_transportation_barrier: 'No'
    });
    await checkAllBoxes();
  });
  await doSection('Advance Care Planning', async () => {
    await setRadios({
      advance_care_planning_directive: 'No',
      advance_care_planning_code_status: 'Unknown',
      advance_care_planning_medical_power: 'No',
      advance_care_planning_acceptable_emergency: 'Yes',
      advance_care_planning_advocate: 'No'
    });
    await checkAllBoxes();
  });
  // Diagnosis: the Z-code pills are `<div class="tag">` inside `.essentials`.
  // A TRUSTED locator click sets `class="tag active"`; a JS click or a
  // coordinate click does nothing (the coords go stale as the panel scrolls, and
  // the row's right-hand switch is a "Description" toggle, not the selector).
  // The code list lazy-loads — wait for it before clicking (2026-07-30).
  await doSection('Diagnosis', async () => {
    await until(() => provPage.evaluate(() =>
      !/Loading\.\.\./.test(document.body.innerText) && /Z00\.01/.test(document.body.innerText)), 20000);
    const chip = provPage.locator('div.tag', { hasText: /^Z00\.01$/ }).first();
    if (await chip.count()) {
      await chip.click({ timeout: 4000 }).catch(() => {});
      await until(() => provPage.evaluate(() => {
        const el = [...document.querySelectorAll('div.tag')].find(e => e.textContent.trim() === 'Z00.01');
        return !!el && /active/.test((el.className || '').toString());
      }), 3000);
    }
  });

  await provPage.screenshot({ path: './prov02-sections.jpeg', type: 'jpeg', quality: 80 });
  out.ok = Object.values(out.sections).every(v => v === 'saved');
  return out;
}
