// prov-01b: the call itself — run right after prov-01a returns ok:true.
// Sequence (user-confirmed 2026-07-15): patient connects → ring the provider
// IMMEDIATELY (zero pause — the test line drops after ~30-60s) → switch to
// the provider context and answer the pop right away (green fa-phone button;
// answering is what ASSIGNS the Pending case) → poll the CA-link until the
// assignment lands (no blind 30s sleep) → open the case.
// NEVER goto/reload the provider page before the pop is answered —
// navigation kills the websocket that delivers presence AND the pop.
// On failure re-run THIS script only, never 01a+01b together.
// Replace __CONFIG__ with { url, caseId, cid } (cid from prov-01a).
async (page) => {
  const CFG = __CONFIG__;
  const out = { stage: 'call-answer-open', ok: false };
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept().catch(() => {}));
  const provCtx = page.context().browser().contexts().find(c => c !== page.context());
  if (!provCtx || !provCtx.pages().length) { out.error = 'provider context missing — run prov-01a first'; return out; }
  const provPage = provCtx.pages()[0];
  provPage.removeAllListeners('dialog');
  provPage.on('dialog', d => d.accept().catch(() => {}));

  // ensure the call overlay is up (prov-01a leaves it open)
  const overlayOpen = () => page.evaluate(() => /Call Mobile|Switch to Digital|Patient:\s*\+1/.test(document.body.innerText));
  if (!(await overlayOpen())) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.querySelector('i[class*="fa-phone"]'));
      btns[0]?.click();
    });
    await page.waitForTimeout(4000);
    if (!(await overlayOpen())) { out.error = 'call overlay did not open'; return out; }
  }

  // 1) patient call — skip if a previous attempt left it live.
  //    'Call Mobile' DISAPPEARS once ringing; never re-click it blindly.
  const inPatientCall = () => page.evaluate(() => /Switch to Digital|Patient:\s*\+1/.test(document.body.innerText));
  const waitConnected = () => page.waitForFunction(
    () => /Switch to Digital|Patient:\s*\+1/.test(document.body.innerText), null, { timeout: 30000 }
  ).then(() => true).catch(() => false);
  if (await inPatientCall()) out.patientCall = 'already-live';
  else {
    await page.getByText('Call Mobile', { exact: true }).locator('visible=true').first().click();
    out.patientCall = await waitConnected();
    if (!out.patientCall) {
      await page.waitForTimeout(15000); // testcall line may be busy — one backoff retry
      const cm = page.getByText('Call Mobile', { exact: true }).locator('visible=true').first();
      if (await cm.count()) { await cm.click(); out.patientCall = await waitConnected(); }
    }
    if (!out.patientCall) {
      out.error = 'patient call did not connect (testcall busy?)';
      await page.screenshot({ path: './prov01b-patient-fail.jpeg', type: 'jpeg', quality: 80 });
      return out;
    }
  }

  // 2) ring the provider IMMEDIATELY — no pause between connect and ring.
  //    Two UI variants: (a) per-row Call button (rf-btn-call-single, calibration
  //    2026-07-13), (b) checkbox on the DR VU row + "Ring selected Providers"
  //    button (seen 2026-07-15). Try (a) briefly, then (b).
  const callBtn = page.locator('button.rf-btn-call-single').locator('visible=true').first();
  const cbOk = await callBtn.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (cbOk) {
    await callBtn.click();
    out.ringPath = 'row-call-button';
  } else {
    const row = page.locator('div, li, tr').filter({ hasText: 'DR VU Doctor' }).locator('input[type="checkbox"]').first();
    if (await row.count()) { await row.check({ timeout: 5000 }).catch(() => {}); }
    const ringBtn = page.getByRole('button', { name: /Ring selected Providers/i }).locator('visible=true').first();
    if (!(await ringBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false))) {
      out.error = 'no ring path: neither row Call button nor Ring selected Providers visible';
      await page.screenshot({ path: './prov01b-nocall.jpeg', type: 'jpeg', quality: 80 });
      return out;
    }
    await ringBtn.click();
    out.ringPath = 'ring-selected-providers';
  }
  const voice = page.getByText('Voice', { exact: true }).locator('visible=true').first();
  if (await voice.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await voice.click();
    out.providerRung = 'voice';
  } else out.providerRung = 'direct';

  // 3) answer the pop on the provider side (websocket — arrives within seconds).
  //    A swal (overdue cases) may be up — dismiss it FIRST or it eats the click.
  await provPage.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /^Dismiss$/.test(x.textContent.trim()));
    b?.click();
  }).catch(() => {});
  out.popShown = await provPage.waitForFunction(
    () => /PSTN Call|PSS, PATIENT/.test(document.body.innerText),
    null, { timeout: 25000, polling: 300 }
  ).then(() => true).catch(() => false);
  if (!out.popShown) {
    out.error = 'pop-call did not arrive — provider page was probably navigated after prov-01a';
    await provPage.screenshot({ path: './prov01b-pop-missing.jpeg', type: 'jpeg', quality: 80 });
    return out;
  }
  // the answer button has NO fa-phone <i> (2026-07-15 UI) — find the GREEN
  // square by computed background color inside the pop, then JS-click it
  out.answeredVia = await provPage.evaluate(() => {
    const pop = [...document.querySelectorAll('div')].filter(e => /PSTN Call/.test(e.textContent) && e.textContent.length < 1200)
      .sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!pop) return null;
    const btns = [...pop.querySelectorAll('*')].filter(e => {
      if (!e.offsetParent) return false;
      const r = e.getBoundingClientRect();
      return r.width > 30 && r.width < 130 && r.height > 30 && r.height < 130;
    }).map(e => {
      const m = getComputedStyle(e).backgroundColor.match(/rgb\((\d+), (\d+), (\d+)/);
      return m ? { e, r: +m[1], g: +m[2], b: +m[3] } : null;
    }).filter(Boolean);
    const green = btns.find(x => x.g > 120 && x.g > x.r * 1.5 && x.g > x.b * 1.2);
    if (green) { green.e.click(); return 'green-bg rgb(' + green.r + ',' + green.g + ',' + green.b + ')'; }
    return null;
  });
  await provPage.waitForTimeout(3000);
  out.providerInCall = await provPage.evaluate(() => /Leave call/i.test(document.body.innerText));
  if (!out.providerInCall) {
    out.error = 'pop shown but answer click failed (answeredVia=' + out.answeredVia + ')';
    await provPage.screenshot({ path: './prov01b-answer-fail.jpeg', type: 'jpeg', quality: 80 });
    return out;
  }

  // 4) assignment: poll the CA-link every 5s (≤45s) instead of a blind 30s sleep.
  //    NOTE: the pop/call widget ALSO shows "Case ID: CA-…" — a bare body-text
  //    match is a false positive. Require a case-view section marker too.
  const caseOpen = () => provPage.evaluate((c) => {
    const t = document.body.innerText;
    return new RegExp('Case ID:\\s*' + c).test(t)
      && /(Assessment & Plan|Advance Care Planning|Master Encounter Report|Review of Systems)/.test(t);
  }, CFG.caseId);
  let opened = false;
  for (let i = 0; i < 9 && !opened; i++) {
    await provPage.waitForTimeout(5000);
    await provPage.evaluate((c) => {
      const link = [...document.querySelectorAll('a, u, span, div')].find(e => e.offsetParent && e.textContent.trim() === c && e.children.length === 0);
      link?.click();
    }, CFG.caseId);
    await provPage.waitForTimeout(3000);
    opened = await caseOpen();
    if (!opened) { // CA-link may land on the Task List — trusted-click the case card
      const card = provPage.locator('.gk-cases-wrapper').filter({ hasText: CFG.caseId }).first();
      if (await card.count()) {
        await card.click({ timeout: 5000 }).catch(() => {});
        await provPage.waitForTimeout(3000);
        opened = await caseOpen();
      }
    }
  }
  if (!opened && CFG.cid) {
    // last resort AFTER the pop is answered (case now assigned) — only here is navigation acceptable
    await provPage.goto(CFG.url + '?cid=' + CFG.cid);
    await provPage.waitForTimeout(1500);
    await provPage.reload();
    await provPage.waitForTimeout(5000);
    opened = await provPage.waitForFunction(
      (c) => new RegExp('Case ID:\\s*' + c).test(document.body.innerText), CFG.caseId, { timeout: 15000 }
    ).then(() => true).catch(() => false);
  }
  out.providerCaseOpen = opened;
  await provPage.screenshot({ path: './prov01b-state.jpeg', type: 'jpeg', quality: 80 });
  out.ok = opened;
  return out;
}
