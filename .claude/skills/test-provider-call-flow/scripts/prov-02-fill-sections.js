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
  const jsClickSwal = (ls) => provPage.evaluate((labels) => {
    const b = [...document.querySelectorAll('.swal-modal button, .swal2-popup button')]
      .find(x => labels.includes(x.textContent.trim()) && x.offsetParent);
    if (b) { b.click(); return true; } return false;
  }, ls);
  const clickSection = async (name) => {
    for (let i = 0; i < 3; i++) {
      await provPage.evaluate((n) => {
        const es = [...document.querySelectorAll('strong')].filter(s => s.textContent.trim() === n && s.offsetParent);
        es[es.length - 1]?.click();
      }, name);
      await provPage.waitForTimeout(1200);
      await jsClickSwal(['OK']);
      if (await provPage.evaluate((n) => !![...document.querySelectorAll('h1,h2,h3')].find(e => e.textContent.trim() === n && e.offsetParent), name)) return true;
    }
    return false;
  };
  const saveAndVerify = async (name) => {
    await provPage.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Save' && !b.disabled && b.offsetParent);
      btns[btns.length - 1]?.click();
    });
    for (let t = 0; t < 6; t++) { if (await jsClickSwal(['Yes'])) break; await provPage.waitForTimeout(500); }
    return provPage.waitForFunction(
      (n) => new RegExp('updated the case on[\\s\\S]{0,10}' + n).test(document.body.innerText),
      name, { timeout: 12000 }
    ).then(() => true).catch(() => false);
  };
  // set radios by {namePart: wantedValue} — dash-normalized substring match on value
  const setRadios = (map) => provPage.evaluate((m) => {
    const nrm = (s) => (s || '').replace(/[–—]/g, '-').toLowerCase();
    const done = {};
    for (const [namePart, want] of Object.entries(m)) {
      const rs = [...document.querySelectorAll('input[type="radio"]')].filter(r => r.offsetParent && !r.disabled && r.name.includes(namePart));
      const t = rs.find(x => nrm(x.value) === nrm(want)) || rs.find(x => nrm(x.value).includes(nrm(want)));
      if (t) { if (!t.checked) t.click(); done[namePart] = t.value; }
      else done[namePart] = 'MISS(' + rs.length + ')';
    }
    return done;
  }, map);
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
  const checkBoxesByText = (txt) => provPage.evaluate((t) => {
    let n = 0;
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (!cb.offsetParent || cb.disabled || cb.checked) continue;
      if (new RegExp(t, 'i').test(cb.closest('.formio-component, label, div')?.textContent || '')) { cb.click(); n++; }
    }
    return n;
  }, txt);
  const checkAllBoxes = () => provPage.evaluate(() => {
    let n = 0;
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (cb.offsetParent && !cb.disabled && !cb.checked) { cb.click(); n++; }
    }
    return n;
  });
  const doSection = async (name, fill) => {
    if (!(await clickSection(name))) { out.sections[name] = 'did not open'; return; }
    await provPage.waitForTimeout(800);
    await fill();
    out.sections[name] = (await saveAndVerify(name)) ? 'saved' : 'save-unconfirmed';
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
    await checkBoxesByText('I have checked this section');
  });
  await doSection('Family History', async () => {
    await setRadios({ 'family_history_confirm_has_family': 'Yes' });
    await provPage.waitForTimeout(1500); // member fields render
    await provPage.evaluate(() => {
      const cond = [...document.querySelectorAll('input[type="text"]')].find(i => i.offsetParent && !i.disabled && /Condition \(1\)/.test(i.closest('.formio-component')?.textContent || ''));
      if (cond) {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(cond, 'Cancer');
        cond.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const rgs = {};
      for (const r of document.querySelectorAll('input[type="radio"]')) {
        if (!r.offsetParent || r.disabled) continue;
        (rgs[r.name] = rgs[r.name] || []).push(r);
      }
      for (const rs of Object.values(rgs)) {
        const vals = rs.map(x => x.value).join(',');
        if (/Living/.test(vals)) { const t = rs.find(x => x.value === 'Living'); if (t && !t.checked) t.click(); }
        if (/^M,P/.test(vals)) { const t = rs.find(x => x.value === 'M'); if (t && !t.checked) t.click(); }
      }
    });
    // Relation to Patient (1): Choices — TRUSTED click, lazy options
    const rel = provPage.locator('.formio-component-select').filter({ hasText: 'Relation to Patient (1)' }).locator('.choices').first();
    if (await rel.count()) {
      await rel.click();
      const opt = provPage.locator('.choices__list--dropdown [role="option"]').filter({ hasText: 'Mother' }).first();
      if (await opt.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) await opt.click();
    }
    await checkBoxesByText('Confirm that I have checked');
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
  await doSection('Diagnosis', async () => {
    await provPage.evaluate(() => {
      const chips = [...document.querySelectorAll('*')].filter(e => e.offsetParent && e.textContent.trim() === 'Z00.01' && e.children.length === 0);
      const el = chips[0]?.closest('button') || chips[0];
      if (el && !/active|selected|fill|dark|primary/i.test((el.className || '').toString())) el.click();
    });
  });

  await provPage.screenshot({ path: './prov02-sections.jpeg', type: 'jpeg', quality: 80 });
  out.ok = Object.values(out.sections).every(v => v === 'saved');
  return out;
}
