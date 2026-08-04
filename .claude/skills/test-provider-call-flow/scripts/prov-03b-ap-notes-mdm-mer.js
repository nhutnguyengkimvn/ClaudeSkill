// prov-03b: the FAST provider finish — Assessment & Plan (Discussion Notes +
// MDM) then generate the Master Encounter Report. NO Manage Orders: the user
// creates orders by hand (2026-07-30 decision), so this skips the slow, brittle
// order loop in prov-03 entirely. No placeholders — run via {filename}.
//
// Note: A&P also flags "Lab Orders *" / "Remote Patient Monitoring *" — those
// only clear once at least one lab order and one RPM order exist. Create them
// manually first if you need A&P to go green; this script reports what is left.
//
// SPEED RULE: never `waitForTimeout` for something observable — poll it.
async (page) => {
  const provPage = page.context().browser().contexts().find(c => c !== page.context())?.pages()[0];
  if (!provPage) return { ok: false, error: 'no provider context — run prov-01c (or 01a/01b) first' };
  const out = { stage: 'ap-notes-mdm-mer', ok: false };
  provPage.removeAllListeners('dialog');
  provPage.on('dialog', d => d.accept().catch(() => {}));

  const until = async (fn, timeoutMs = 6000, everyMs = 120) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn().catch(() => false);
      if (v) return v;
      if (Date.now() >= deadline) return false;
      await provPage.waitForTimeout(everyMs);
    }
  };
  const swal = (ls) => provPage.evaluate((labels) => {
    const b = [...document.querySelectorAll('.swal-modal button, .swal2-popup button')]
      .find(x => labels.includes(x.textContent.trim()) && x.offsetParent);
    if (b) { b.click(); return true; } return false;
  }, ls);
  const sectionOpen = (name) => provPage.evaluate((n) =>
    !![...document.querySelectorAll('h1,h2,h3')].find(e => e.textContent.trim() === n && e.offsetParent), name);
  const clickSection = async (name) => {
    if (await sectionOpen(name)) return true;
    for (let i = 0; i < 3; i++) {
      await provPage.evaluate((n) => {
        const es = [...document.querySelectorAll('strong')].filter(s => s.textContent.trim() === n && s.offsetParent);
        es[es.length - 1]?.click();
      }, name);
      await swal(['OK']);
      if (await until(() => sectionOpen(name), 4000)) return true;
    }
    return false;
  };
  // Completeness comes from the SIDEBAR marker: green circle #227110 = complete,
  // svg.gk-section-valid-icon wraps id="icon-error" = the red asterisk. Scope to
  // `.card-header strong` — a duplicate <strong> elsewhere flips the answer.
  const state = (name) => provPage.evaluate((n) => {
    const s = [...document.querySelectorAll('.card-header strong')].filter(e => e.textContent.trim() === n).pop();
    if (!s) return 'not-found';
    const h = s.parentElement.outerHTML;
    return /#227110/.test(h) ? 'complete' : /gk-section-valid-icon/.test(h) ? 'INCOMPLETE' : 'no-marker';
  }, name);

  // 0. close a leftover order form / Manage Orders modal, it swallows clicks
  if (await provPage.evaluate(() => /Available Services|Save Order/.test(document.body.innerText))) {
    await provPage.evaluate(() => {
      const cancel = [...document.querySelectorAll('button')].find(b => b.offsetParent && /^(Cancel|Discard Order)$/.test(b.textContent.trim()));
      cancel?.click();
    });
    await provPage.evaluate(() => {
      const x = [...document.querySelectorAll('button')].find(b => b.offsetParent && (b.textContent.trim() === '×' || b.className.includes('close')));
      x?.click();
    });
    await until(() => provPage.evaluate(() => !/Available Services|Save Order/.test(document.body.innerText)), 3000);
  }

  // 1. Assessment & Plan — Discussion Notes + MDM by EXACT field name
  if (!(await clickSection('Assessment & Plan'))) { out.error = 'Assessment & Plan did not open'; return out; }
  await until(() => provPage.evaluate(() =>
    !!document.querySelector('textarea[name="data[assessment_plan_discussion_notes]"]')), 5000);
  out.filled = await provPage.evaluate(() => {
    const res = {};
    const ta = document.querySelector('textarea[name="data[assessment_plan_discussion_notes]"]');
    if (!ta) res.discussionNotes = 'not-found';
    else {
      if (!ta.value.trim()) {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta,
          'Reviewed wellness screening results, current health status and lifestyle recommendations with the patient. Preventive care and follow-up plan discussed.');
        for (const ev of ['input', 'change', 'blur']) ta.dispatchEvent(new Event(ev, { bubbles: true }));
      }
      res.discussionNotes = ta.value.length + ' chars';
    }
    const mdm = [...document.querySelectorAll('input[type="radio"]')]
      .filter(r => r.offsetParent && !r.disabled && /assessment_plan_mdm_level/.test(r.name));
    const t = mdm.find(r => /straightforward/i.test(r.value)) || mdm[0];
    if (t) { if (!t.checked) t.click(); res.mdm = t.value; } else res.mdm = 'not-found';
    return res;
  });
  await provPage.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Save' && !x.disabled && x.offsetParent);
    b[b.length - 1]?.click();
  });
  await until(async () => (await swal(['Yes']))
    || provPage.evaluate(() => /updated the case on[\s\S]{0,15}(Assessment|Care Plan)/i.test(document.body.innerText)), 1500, 100);
  out.apSaved = await provPage.waitForFunction(
    () => /updated the case on[\s\S]{0,15}(Assessment|Care Plan|Progress)/i.test(document.body.innerText),
    null, { timeout: 12000 }).then(() => true).catch(() => false);
  out.apState = await until(async () => (await state('Assessment & Plan')) === 'complete', 2500)
    ? 'complete' : await state('Assessment & Plan');
  if (out.apState !== 'complete') {
    out.apMissing = await provPage.evaluate(() => {
      const form = [...document.querySelectorAll('.formio-form')].find(f => f.offsetParent && f.querySelectorAll('.formio-component').length > 2);
      const miss = [];
      for (const c of (form || document).querySelectorAll('.formio-component')) {
        if (!c.offsetParent) continue;
        const lbl = c.querySelector('label');
        if (!lbl || !/\*/.test(lbl.textContent)) continue;
        const ins = [...c.querySelectorAll('input, textarea, select')];
        if (ins.length && !ins.some(i => (i.type === 'radio' || i.type === 'checkbox') ? i.checked : (i.value || '').trim().length > 0))
          miss.push(lbl.textContent.replace(/\s+/g, ' ').trim().slice(0, 45));
      }
      return miss;
    });
  }

  // 2. Master Encounter Report — click Generate/Update, then wait for real content
  if (!(await clickSection('Master Encounter Report'))) { out.error = 'MER did not open'; return out; }
  out.merClicked = await provPage.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && !x.disabled && /(Generate|Update).*(Report|AI)/i.test(x.textContent));
    if (b) { const t = b.textContent.replace(/\s+/g, ' ').trim(); b.click(); return t; } return null;
  });
  // Do NOT treat template headings as proof: "Subjective" is printed before any
  // AI content exists (false positive on 2026-07-30). Require the section marker
  // to go green, or a busy indicator to disappear after having been seen.
  out.merGenerated = await until(async () => (await state('Master Encounter Report')) === 'complete', 180000, 3000);
  out.merState = await state('Master Encounter Report');
  await provPage.screenshot({ path: './prov03b-final.jpeg', type: 'jpeg', quality: 80 });
  out.ok = out.apSaved && out.merState === 'complete';
  return out;
}
