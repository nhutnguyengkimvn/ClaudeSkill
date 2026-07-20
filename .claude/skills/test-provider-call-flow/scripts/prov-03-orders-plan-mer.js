// prov-03: Assessment & Plan — create ALL orders via Manage Orders, add a
// Care Plan item + Discussion Notes, Save, then generate the Master
// Encounter Report and wait for it. No placeholders — run via {filename}.
//
// Encoded lessons: Choices selects have LAZY options → TRUSTED clicks only;
// placeholder items carry .choices__placeholder; pick NON-"CUSTOM PANEL"
// panels; CGX: pick a NON-Breast personal-cancer option (breast spawns a
// required laterality field); CGM/BGM: 3-checkbox consent first, then
// Supplier/Device selects + Year=2020 + remaining radios default No.
async (page) => {
  const provPage = page.context().browser().contexts().find(c => c !== page.context())?.pages()[0];
  if (!provPage) return { ok: false, error: 'no provider context — run prov-01 first' };
  const out = { stage: 'orders-plan-mer', orders: {}, ok: false };
  provPage.removeAllListeners('dialog');
  provPage.on('dialog', d => d.accept().catch(() => {}));

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
      if (await provPage.evaluate((n) => !![...document.querySelectorAll('h1,h2,h3')].find(e => e.textContent.includes(n) && e.offsetParent), name)) return true;
    }
    return false;
  };
  const formState = () => provPage.evaluate(() => {
    const t = document.body.innerText;
    return {
      inForm: [...document.querySelectorAll('button')].some(b => b.offsetParent && /Save Order/i.test(b.textContent)),
      services: /Available Services/.test(t),
      err: (t.match(/[^\n]*is required[^\n]*/i) || [null])[0]
    };
  });
  const handleConsent = async () => {
    if (!(await provPage.evaluate(() => /Patient Consent:/.test(document.body.innerText)))) return false;
    await provPage.evaluate(() => {
      for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
        if (cb.offsetParent && !cb.disabled && !cb.checked && /Patient agrees/.test(cb.closest('label, div')?.textContent || '')) cb.click();
      }
    });
    await provPage.waitForTimeout(400);
    await provPage.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /Confirm Consent/.test(x.textContent) && !x.disabled);
      b?.click();
    });
    await provPage.waitForTimeout(2500);
    return true;
  };
  // pick an option in a Choices select by label (trusted, lazy-aware, avoid-list)
  const pickSelect = async (labelPart, avoidRe) => {
    const combo = provPage.locator('.formio-component-select').filter({ hasText: labelPart }).locator('.choices').first();
    if (!(await combo.count())) return 'no-select';
    const empty = await combo.evaluate(c => {
      const it = c.querySelector('.choices__list--single .choices__item');
      return !it || !it.textContent.trim() || it.classList.contains('choices__placeholder');
    }).catch(() => false);
    if (!empty) return 'already-set';
    await combo.click().catch(() => {});
    const opts = provPage.locator('.choices__list--dropdown [role="option"]').locator('visible=true');
    for (let t = 0; t < 15; t++) {
      const n = await opts.count();
      if (n > 0) {
        const texts = [];
        for (let i = 0; i < n && i < 10; i++) texts.push(((await opts.nth(i).textContent()) || '').trim());
        let idx = texts.findIndex(x => x && !/^select/i.test(x) && !(avoidRe && avoidRe.test(x)));
        if (idx < 0) idx = texts.findIndex(x => x && !/^select/i.test(x));
        if (idx >= 0) { await opts.nth(idx).click(); await provPage.waitForTimeout(1200); return texts[idx].slice(0, 40); }
      }
      await provPage.waitForTimeout(1000);
    }
    await provPage.keyboard.press('Escape').catch(() => {});
    return 'no-options';
  };
  // fill any remaining empty selects near Save Order (Indications etc.)
  const fillRemainingSelects = async (avoidRe) => {
    for (let k = 0; k < 5; k++) {
      const label = await provPage.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.offsetParent && /Save Order/i.test(b.textContent));
        if (!btn) return null;
        let root = btn;
        for (let i = 0; i < 12 && root; i++) { if (root.querySelectorAll('.choices').length) break; root = root.parentElement; }
        for (const c of [...(root || document).querySelectorAll('.choices')].filter(x => x.offsetParent && !x.classList.contains('is-disabled'))) {
          const it = c.querySelector('.choices__list--single .choices__item');
          if (!it || !it.textContent.trim() || it.classList.contains('choices__placeholder')) {
            const l = (c.closest('.formio-component')?.querySelector('label')?.textContent || '').trim();
            if (l && !/Relevant Diagnosis|Additional|Instructions/i.test(l)) return l.replace(/\s*\*\s*$/, '').slice(0, 30);
          }
        }
        return null;
      });
      if (!label) return;
      const r = await pickSelect(label, avoidRe);
      if (r === 'no-options' || r === 'no-select') return;
    }
  };
  const fillTextsAndRadios = () => provPage.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.offsetParent && /Save Order/i.test(b.textContent));
    let root = btn;
    for (let i = 0; i < 12 && root; i++) { if (root.querySelectorAll('input, textarea').length > 2) break; root = root.parentElement; }
    if (!root) return;
    for (const inp of root.querySelectorAll('input[type="text"], input[type="number"]')) {
      if (!inp.offsetParent || inp.disabled || inp.value) continue;
      const lbl = (inp.closest('.formio-component')?.querySelector('label')?.textContent || '');
      if (/Year/i.test(lbl)) {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, '2020');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    const rgs = {};
    for (const r of root.querySelectorAll('input[type="radio"]')) {
      if (!r.offsetParent || r.disabled) continue;
      (rgs[r.name] = rgs[r.name] || []).push(r);
    }
    for (const rs of Object.values(rgs)) {
      const t = rs.find(x => /^no$/i.test(x.value)) || rs[0];
      if (t && !t.checked) t.click();
    }
    const cbs = [...root.querySelectorAll('input[type="checkbox"]')].filter(c => c.offsetParent && !c.disabled && !c.checked);
    if (cbs[0]) cbs[0].click(); // Reason for Exam
    for (const c of cbs) if (/Current/.test(c.closest('label, div')?.textContent || '') && !c.checked) c.click();
  });
  const saveOrder = async () => {
    await provPage.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /Save Order/i.test(x.textContent) && !x.disabled);
      b?.click();
    });
    await provPage.waitForTimeout(3500);
  };
  const cancelForm = async () => {
    await provPage.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /^(Cancel|Discard Order)$/.test(x.textContent.trim()));
      b?.click();
    });
    await provPage.waitForTimeout(1500);
  };
  const ensureServicesList = async () => {
    if (await provPage.evaluate(() => /Available Services/.test(document.body.innerText))) return true;
    await provPage.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.textContent.trim() === 'Manage Orders');
      btns[btns.length - 1]?.click();
    });
    await provPage.waitForTimeout(2000);
    return provPage.evaluate(() => /Available Services/.test(document.body.innerText));
  };

  // ---- open Assessment & Plan + Manage Orders, then order EVERY service that still shows an Order button ----
  if (!(await clickSection('Assessment & Plan'))) { out.error = 'A&P did not open'; return out; }
  if (!(await ensureServicesList())) { out.error = 'Manage Orders did not open'; return out; }
  for (let i = 0; i < 8; i++) {
    // find the first service row that still has an exact 'Order' button
    const svc = await provPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === 'Order');
      if (!btn) return null;
      let p = btn;
      for (let k = 0; k < 6 && p; k++) { if (p.textContent.length < 300 && /\(/.test(p.textContent)) break; p = p.parentElement; }
      const name = (p?.textContent.match(/^[^\n(]{3,60}\(/) || [''])[0].replace('(', '').trim() || 'unknown';
      btn.click();
      return name;
    });
    if (!svc) break; // nothing left to order
    await provPage.waitForTimeout(2500);
    await handleConsent(); // CGM/BGM starts with consent
    await pickSelect('Test Panel', /custom/i);
    await fillRemainingSelects(/breast/i); // CGX: avoid Breast options
    await fillTextsAndRadios();
    await saveOrder();
    await handleConsent();
    let s = await formState();
    if (s.inForm && !s.services) { // one retry: newly-flagged fields
      await fillRemainingSelects(/breast/i);
      await fillTextsAndRadios();
      await saveOrder();
      s = await formState();
    }
    out.orders[svc] = (s.services || !s.inForm) ? 'created' : 'failed: ' + (s.err || '?');
    if (s.inForm && !s.services) { await provPage.screenshot({ path: './prov03-ofail-' + i + '.jpeg', type: 'jpeg', quality: 80 }); await cancelForm(); }
    if (!(await ensureServicesList())) break;
  }
  // close Manage Orders
  await provPage.evaluate(() => {
    const x = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === '×');
    x?.click();
  });
  await provPage.waitForTimeout(1500);

  // ---- Add Plan Item + Discussion Notes + Save ----
  await provPage.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /Add Plan Item/.test(x.textContent));
    b?.click();
  });
  await provPage.waitForTimeout(2000);
  await pickSelect('Problem', null);
  await provPage.evaluate(() => {
    const rgs = {};
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (!r.offsetParent || r.disabled) continue;
      (rgs[r.name] = rgs[r.name] || []).push(r);
    }
    for (const rs of Object.values(rgs)) {
      const vals = rs.map(x => x.value).join(',');
      if (/Chronic/.test(vals)) { const t = rs.find(x => x.value === 'Chronic'); if (t && !t.checked) t.click(); }
      if (/Active/.test(vals) && /Inactive/.test(vals)) { const t = rs.find(x => x.value === 'Active'); if (t && !t.checked) t.click(); }
    }
    for (const ta of document.querySelectorAll('textarea')) {
      if (!ta.offsetParent || ta.disabled || ta.value) continue;
      const lbl = (ta.closest('.formio-component')?.querySelector('label')?.textContent || ta.placeholder || '');
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      if (/Care Goals|goals/i.test(lbl)) { set.call(ta, 'Maintain healthy weight; blood pressure under 130/80; improved glucose control.'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
      else if (/Plan/i.test(lbl)) { set.call(ta, 'Continue lifestyle modification. Monitor blood glucose with CGM/BGM device. Follow up in 3 months.'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  });
  await provPage.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.textContent.trim() === 'Save' && !b.disabled);
    btns[btns.length - 1]?.click();
  });
  await provPage.waitForTimeout(2500);
  out.planItemAdded = await provPage.evaluate(() => !/No Care Plan items added/.test(document.body.innerText));
  await provPage.evaluate(() => {
    for (const ta of document.querySelectorAll('textarea')) {
      if (!ta.offsetParent || ta.disabled || ta.value) continue;
      if ((ta.placeholder || '').toLowerCase().includes('discussion')) {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Discussed wellness screening results, lifestyle recommendations and remote monitoring options with the patient.');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.textContent.trim() === 'Save' && !b.disabled);
    btns[btns.length - 1]?.click();
  });
  for (let t = 0; t < 6; t++) { if (await jsClickSwal(['Yes'])) break; await provPage.waitForTimeout(500); }
  out.apSaved = await provPage.waitForFunction(
    () => /updated the case on[\s\S]{0,15}(Assessment|Care Plan|Progress)/i.test(document.body.innerText),
    null, { timeout: 12000 }).then(() => true).catch(() => false);

  // ---- Master Encounter Report ----
  if (!(await clickSection('Master Encounter Report'))) { out.error = 'MER did not open'; return out; }
  out.merClicked = await provPage.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /(Update|Generate) Report with AI/i.test(x.textContent) && !x.disabled);
    if (b) { const t = b.textContent.trim(); b.click(); return t; } return null;
  });
  await provPage.waitForTimeout(5000);
  out.merGenerated = await provPage.waitForFunction(() => {
    const t = document.body.innerText;
    const busy = /generating|analyzing|please wait/i.test(t) || [...document.querySelectorAll('.spinner, [class*="spin"], [class*="loading"]')].some(e => e.offsetParent);
    return !busy && /PROGRESS NOTES \(SOAP\)|Subjective/.test(t);
  }, null, { timeout: 180000, polling: 3000 }).then(() => true).catch(() => false);
  await provPage.screenshot({ path: './prov03-mer.jpeg', type: 'jpeg', quality: 80 });
  out.ok = out.merGenerated;
  return out;
}
