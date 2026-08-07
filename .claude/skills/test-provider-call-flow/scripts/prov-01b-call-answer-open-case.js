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

  // Ensure the call overlay is up. prov-01a leaves it open, but the user (or a
  // "Leave call") can close it between runs — retrying 01b must reopen it, not
  // die 30s later on a missing "Call Mobile" (hit 2026-08-07).
  const overlayOpen = () => page.evaluate(() =>
    !!document.body && /Call Mobile|Switch to Digital|Patient:\s*\+1/.test(document.body.innerText));
  if (!(await overlayOpen())) {
    // the phone icon is the 2nd of the 3 header icons (envelope / phone / history)
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.querySelector('i[class*="fa-phone"]'));
      btns[0]?.click();
    });
    for (let i = 0; i < 20 && !(await overlayOpen()); i++) await page.waitForTimeout(500);
    if (!(await overlayOpen())) { out.error = 'call overlay did not open (phone icon in the case header)'; return out; }
  }

  // 1) patient call — skip if a previous attempt left it live.
  //    'Call Mobile' DISAPPEARS once ringing; never re-click it blindly.
  //    UI states (user screenshots 2026-08-07):
  //      idle      → patient card + [Call Mobile |v] + [Send Invite |v]
  //      ringing   → "+1 804 222 1111" + "Calling..."
  //      connected → timer "00:17/ 20 mins", waveform, "Switch to Digital",
  //                  bottom-left "Patient: +1 804 222 1111"
  const inPatientCall = () => page.evaluate(() =>
    /Switch to Digital|Patient:\s*\+1|\d{2}:\d{2}\s*\/\s*\d+\s*mins/.test(document.body.innerText));
  const isRinging = () => page.evaluate(() => /Calling\.\.\./.test(document.body.innerText));
  const waitConnected = () => page.waitForFunction(
    () => /Switch to Digital|Patient:\s*\+1|\d{2}:\d{2}\s*\/\s*\d+\s*mins/.test(document.body.innerText),
    null, { timeout: 45000, polling: 500 }
  ).then(() => true).catch(() => false);
  // The DOCUMENTED path (user 2026-08-07): click the CARET next to "Call Mobile"
  // and pick "Call Mobile" from the dropdown (the menu also offers a disabled
  // "Call Landline" and "Open Dialer"). Clicking the big button directly usually
  // works too, so try the caret first and fall back.
  const startPatientCall = async () => {
    const caretClicked = await page.evaluate(() => {
      // the caret is the narrow sibling to the RIGHT of the Call Mobile button
      const label = [...document.querySelectorAll('*')].find(e => e.offsetParent
        && e.textContent.trim() === 'Call Mobile' && e.children.length === 0);
      if (!label) return false;
      const btn = label.closest('button') || label.parentElement;
      const box = btn?.parentElement;
      if (!box) return false;
      const caret = [...box.querySelectorAll('button, div, span')].find(e => {
        if (!e.offsetParent || e === btn || btn.contains(e)) return false;
        const r = e.getBoundingClientRect();
        return r.width > 10 && r.width < 60 && r.height > 30;
      });
      if (caret) { caret.click(); return true; }
      return false;
    });
    if (caretClicked) {
      const item = page.getByText('Call Mobile', { exact: true }).locator('visible=true').last();
      if (await item.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) {
        await item.click().catch(() => {});
        out.patientCallPath = 'caret-dropdown';
        return;
      }
    }
    await page.getByText('Call Mobile', { exact: true }).locator('visible=true').first().click();
    out.patientCallPath = out.patientCallPath || 'direct-button';
  };
  if (await inPatientCall()) out.patientCall = 'already-live';
  else {
    await startPatientCall();
    out.ringingSeen = await page.waitForFunction(() => /Calling\.\.\.|Switch to Digital|Patient:\s*\+1/.test(document.body.innerText),
      null, { timeout: 10000, polling: 300 }).then(() => true).catch(() => false);
    out.patientCall = await waitConnected();
    if (!out.patientCall) {
      await page.waitForTimeout(15000); // testcall line may be busy — one backoff retry
      if (!(await isRinging()) && !(await inPatientCall())) {
        await startPatientCall().catch(() => {});
        out.patientCall = await waitConnected();
      }
    }
    if (!out.patientCall) {
      out.error = 'patient call did not connect (testcall busy?)';
      await page.screenshot({ path: './prov01b-patient-fail.jpeg', type: 'jpeg', quality: 80 });
      return out;
    }
  }

  // 2) ring the provider IMMEDIATELY — no pause between connect and ring.
  //    THE ROW'S "Call" BUTTON IS HOVER-REVEALED AND WORKS WHILE THE BADGE SAYS
  //    "Offline" (user screenshots 2026-08-07). Do NOT wait for "Online" and do
  //    NOT treat Offline as a blocker — that mistake burned the 2026-07-15 run.
  //    Layout of the row: [checkbox] [avatar] DR VU Doctor / 8 States ……… Call | Offline
  //    Hovering the row makes "Call" appear; clicking it opens a Voice/Video menu.
  const rowBox = await page.evaluate(() => {
    const name = [...document.querySelectorAll('*')].find(e => e.offsetParent
      && e.textContent.trim() === 'DR VU Doctor' && e.children.length === 0);
    if (!name) return null;
    let el = name;
    for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width > 300 && r.height > 30 && r.height < 160) return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return null;
  });
  if (!rowBox) {
    out.error = 'DR VU Doctor row not found in the call overlay';
    await page.screenshot({ path: './prov01b-norow.jpeg', type: 'jpeg', quality: 80 });
    return out;
  }
  // CLICK the row (user-corrected 2026-08-07) — hovering is NOT enough and the
  // blue "Ring selected Providers" button is NOT the path: pressing it without a
  // ticked provider only pops **"Please select provider to call list" → Got it**.
  // Clicking the row itself selects the provider and reveals its **Call** button.
  // Click the NAME area (~35% of the row width), never the leading checkbox.
  const gotIt = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => x.offsetParent && /^Got it$/i.test(x.textContent.trim()));
    if (b) { b.click(); return true; } return false;
  });
  await page.mouse.click(rowBox.x + rowBox.w * 0.35, rowBox.y + rowBox.h / 2);
  await page.waitForTimeout(500);
  await gotIt();   // clear the dialog if a stray Ring press produced it
  const callBtn = page.locator('button.rf-btn-call-single').locator('visible=true').first();
  const callText = page.getByText('Call', { exact: true }).locator('visible=true').first();
  const callReady = async () => (await callBtn.count()) > 0 || (await callText.count()) > 0;
  for (let i = 0; i < 12 && !(await callReady()); i++) {          // ≤6s
    await page.mouse.move(rowBox.x + rowBox.w * 0.75, rowBox.y + rowBox.h / 2);
    await page.waitForTimeout(500);
  }
  if ((await callBtn.count()) > 0) {
    await callBtn.click();
    out.ringPath = 'row-click → Call button';
  } else if ((await callText.count()) > 0) {
    await callText.click();
    out.ringPath = 'row-click → Call text';
  } else {
    out.error = 'Call button never appeared after clicking the DR VU Doctor row';
    await page.screenshot({ path: './prov01b-nocall.jpeg', type: 'jpeg', quality: 80 });
    return out;
  }
  // the Call button opens a Voice / Video menu → always pick Voice
  const voice = page.getByText('Voice', { exact: true }).locator('visible=true').first();
  if (await voice.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await voice.click();
    out.providerRung = 'voice';
  } else out.providerRung = 'direct';
  if (await gotIt()) {           // "Please select provider to call list" → the row selection did not stick
    out.error = 'ring rejected: "Please select provider to call list" — the row was not selected before Call';
    await page.screenshot({ path: './prov01b-select-provider.jpeg', type: 'jpeg', quality: 80 });
    return out;
  }

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
  // EXACT ANSWER BUTTON (captured 2026-08-07):
  //   answer  → button.btn.btn-success.btn-lg  >  i.spicon-call-up     (green, 56×56)
  //   decline → button.btn.btn-danger.btn-lg   >  i.spicon-icon-call-off (red, 56×56)
  // The old detector scoped the search to a <div> ancestor containing "PSTN Call"
  // and found nothing — the buttons live OUTSIDE that node. Scope document-wide.
  // ANSWER FIRST, INSPECT LATER: the pop self-dismisses in ~20-30s, so never run
  // DOM analysis before clicking (that is exactly what lost the 2026-08-07 pop).
  out.answeredVia = null;
  const answerBtn = provPage.locator('button.btn-success:has(i.spicon-call-up)').locator('visible=true').first();
  if (await answerBtn.count()) {
    await answerBtn.click({ timeout: 5000 }).catch(() => {});
    out.answeredVia = 'btn-success + spicon-call-up';
  } else {
    out.answeredVia = await provPage.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(e => {
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
  }
  // poll for the in-call state instead of a blind 3s wait
  for (let i = 0; i < 24; i++) {
    if (await provPage.evaluate(() => /Leave call/i.test(document.body.innerText))) break;
    await provPage.waitForTimeout(500);
  }
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
