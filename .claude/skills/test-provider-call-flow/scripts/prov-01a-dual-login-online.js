// prov-01a: dual logins + provider ONLINE check. NO calling here — prov-01b
// runs the call. Split from the old prov-01 on purpose: goto/reload on the
// provider page KILLS the presence websocket (row shows Offline → no Call
// button, no pop), so call retries must never re-run navigation. This script
// only navigates a page when its session is missing or wrong-role.
// Replace __CONFIG__ with
// { url, pssEmail, pssPassword, provEmail, provPassword, caseId }.
async (page) => {
  const CFG = __CONFIG__;
  const out = { stage: 'dual-login-online', ok: false };
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept().catch(() => {}));

  const login = async (pg, email, pass) => {
    const u = pg.getByRole('textbox', { name: 'Username *' });
    if (await u.count()) {
      await u.fill(email);
      await pg.getByRole('textbox', { name: 'Password *' }).fill(pass);
      await pg.getByRole('button', { name: 'Continue' }).click();
    }
  };
  const dismiss = (pg) => pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /^(Dismiss)$/.test(x.textContent.trim()))
      || document.querySelector('.swal-button--cancel');
    if (b && b.offsetParent) b.click();
  });
  const origin = CFG.url.split('/#')[0];

  // ---- PSS (default context) — reuse the live session when possible ----
  await page.context().grantPermissions(['microphone'], { origin });
  // dashboard renders slowly after login — POLL for the role marker, never a one-shot check
  const isPssNow = (ms) => page.waitForFunction(() =>
    [...document.querySelectorAll('.nav-title')].some(e => e.textContent.trim() === 'Call Scoring'),
    null, { timeout: ms }).then(() => true).catch(() => false);
  let isPss = await isPssNow(3000);
  if (!isPss) {
    // close other dashboard tabs first — they resurrect a cleared session
    for (const pg of page.context().pages()) {
      if (pg !== page && /dnainsights/.test(pg.url())) await pg.close().catch(() => {});
    }
    await page.goto(CFG.url);
    await page.waitForTimeout(2000);
    await login(page, CFG.pssEmail, CFG.pssPassword);
    isPss = await isPssNow(20000);
    if (!isPss) {
      // wrong-role session → UI logout (storage clears don't stick) then login
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('i.fa-right-from-bracket'));
        btn?.click();
      });
      await page.getByRole('textbox', { name: 'Username *' }).waitFor({ state: 'visible', timeout: 15000 });
      await login(page, CFG.pssEmail, CFG.pssPassword);
      isPss = await isPssNow(20000);
      if (!isPss) { out.error = 'PSS login failed'; return out; }
    }
  }
  await dismiss(page);

  // open the case if not already on it (search → trusted click on the card)
  const onCase = () => page.evaluate((c) => new RegExp('Case ID:\\s*' + c).test(document.body.innerText), CFG.caseId);
  if (!(await onCase())) {
    const search = page.getByRole('textbox', { name: 'Search case' });
    await search.fill(CFG.caseId);
    await search.press('Enter');
    const card = page.locator('.gk-cases-wrapper').filter({ hasText: CFG.caseId }).first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    await card.click();
    const matched = await page.waitForFunction(
      (cid) => new RegExp('Case ID:\\s*' + cid).test(document.body.innerText), CFG.caseId, { timeout: 15000 }
    ).then(() => true).catch(() => false);
    if (!matched) { out.error = 'PSS could not open case ' + CFG.caseId; return out; }
  }
  out.cid = (page.url().match(/cid=([a-f0-9-]+)/) || [])[1] || null;

  // ---- PROVIDER (second context) — goto/login ONLY when the session is dead ----
  let provCtx = page.context().browser().contexts().find(c => c !== page.context());
  if (!provCtx) provCtx = await page.context().browser().newContext();
  await provCtx.grantPermissions(['microphone', 'notifications'], { origin });
  const provPage = provCtx.pages()[0] || await provCtx.newPage();
  provPage.removeAllListeners('dialog');
  provPage.on('dialog', d => d.accept().catch(() => {}));
  // `document.body` is NULL for a moment while the SPA re-renders after login —
  // an unguarded `document.body.innerText` THROWS, waitForFunction rejects, the
  // .catch() swallows it and the script reports a bogus "provider login failed"
  // on a session that logged in perfectly (hit 2026-08-07). Always guard body.
  const provLoggedIn = (ms) => provPage.waitForFunction(() =>
    !!document.body && ([...document.querySelectorAll('.nav-title')].some(e => e.textContent.trim() === 'Result Dashboard')
    || /\+ Busy Time/.test(document.body.innerText)), null, { timeout: ms, polling: 500 })
    .then(() => true).catch(() => false);
  if (!(await provLoggedIn(3000))) {
    await provPage.setViewportSize({ width: 1600, height: 1000 });
    await provPage.goto(CFG.url);
    // poll for the login form instead of a fixed 2s — a slow render made the
    // fill() run against a not-yet-mounted form and the login silently no-op'd
    await provPage.getByRole('textbox', { name: 'Username *' })
      .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await login(provPage, CFG.provEmail, CFG.provPassword);
    await dismiss(provPage).catch(() => {});
  }
  out.providerLoggedIn = await provLoggedIn(30000);
  if (!out.providerLoggedIn) { out.error = 'provider login failed'; return out; }
  // From here on the provider page must sit UNTOUCHED on the dashboard —
  // prov-01b relies on this websocket for both presence and the pop-call.

  // ---- PSS: open the call overlay + wait for the provider row to show Online ----
  const overlayOpen = () => page.evaluate(() => /Call Mobile|Switch to Digital|Patient:\s*\+1/.test(document.body.innerText));
  const openOverlay = () => page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.querySelector('i[class*="fa-phone"]'));
    btns[0]?.click();
  });
  if (!(await overlayOpen())) { await openOverlay(); await page.waitForTimeout(4000); }
  if (!(await overlayOpen())) { out.error = 'call overlay did not open'; return out; }

  // ---- The prerequisite is the ROW, not the "Online" badge ----
  // CORRECTED 2026-08-07 (user screenshots): the per-row **Call** button appears
  // on HOVER even while the badge reads **Offline**, and ringing an "Offline"
  // DR VU Doctor still delivers the pop. The old hard gate polled 90s for
  // "Online", never saw it, and aborted a run that would have worked — that was
  // the 2026-07-15 "BLOCKED at ring-provider" failure. Presence is INFORMATIONAL
  // only; never block on it.
  // scan ALL tags: the provider name is a LEAF element whose tag varies (it was
  // not a div/li/tr/span on 2026-08-07, so the old scoped scan reported "row
  // never appeared" while the row was plainly on screen and Online).
  const rowPresence = () => page.evaluate(() => {
    let el = [...document.querySelectorAll('*')]
      .filter(e => e.offsetParent && /DR VU/i.test(e.textContent) && e.textContent.length < 200)
      .sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!el) return null;
    for (let i = 0; el && i < 6; i++, el = el.parentElement) {
      const t = el.textContent;
      if (t.length < 600 && /Online|Offline/i.test(t)) return /(\bOnline\b)/i.test(t) ? 'Online' : 'Offline';
    }
    return 'row-present-no-badge';
  });
  // wait only for the row to EXIST (the provider list loads async), ≤20s
  const rowExists = () => page.evaluate(() =>
    [...document.querySelectorAll('*')].some(e => e.offsetParent && /DR VU/i.test(e.textContent) && e.textContent.length < 200));
  out.providerRowVisible = await rowExists();
  for (let i = 0; i < 10 && !out.providerRowVisible; i++) {
    await page.waitForTimeout(2000);
    out.providerRowVisible = await rowExists();
  }
  if (!out.providerRowVisible) {
    out.error = 'DR VU Doctor row never appeared in the call overlay provider list';
    await page.screenshot({ path: './prov01a-norow.jpeg', type: 'jpeg', quality: 80 });
    return out;
  }
  out.providerPresence = await rowPresence();   // informational — Offline is FINE
  out.ok = true;
  return out;
}
