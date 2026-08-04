// prov-01c: provider-only entry point for a case that is ALREADY Assigned
// (the call was made outside this run, or the case auto-assigned). Skips the
// whole call sequence of 01a/01b: logs the PROVIDER into a second browser
// context and opens the case so prov-02/prov-03 can run.
// Replace __CONFIG__ with { url, provEmail, provPassword, caseId, cid }.
//
// Landmines handled (see SKILL.md):
// - The URL-cid shortcut ONLY works on cases already assigned to this provider
//   — that is exactly this script's precondition. Task List search is the
//   primary path, cid+reload the fallback.
// - goto() on a `#/?cid=` hash URL does NOT re-render the SPA → always follow
//   it with a real reload().
// - A "Document Review & Sign off" modal can cover the page and swallow clicks.
// - No presence websocket is needed here (no call), so navigating is safe.
async (page) => {
  const CFG = __CONFIG__;
  const out = { stage: 'provider-open-assigned-case', ok: false };
  const origin = CFG.url.split('/#')[0];

  let provCtx = page.context().browser().contexts().find(c => c !== page.context());
  if (!provCtx) provCtx = await page.context().browser().newContext();
  await provCtx.grantPermissions(['microphone', 'notifications'], { origin });
  const provPage = provCtx.pages()[0] || await provCtx.newPage();
  provPage.removeAllListeners('dialog');
  provPage.on('dialog', d => d.accept().catch(() => {}));

  const login = async (pg, email, pass) => {
    const u = pg.getByRole('textbox', { name: 'Username *' });
    if (await u.count()) {
      await u.fill(email);
      await pg.getByRole('textbox', { name: 'Password *' }).fill(pass);
      await pg.getByRole('button', { name: 'Continue' }).click();
    }
  };
  // DOCTOR-role check: only the provider nav has "Result Dashboard" / "Busy Time".
  // Must be an evaluate POLL LOOP, not waitForFunction: the SPA navigates right
  // after the login click, which destroys the execution context and makes
  // waitForFunction reject — reporting "login failed" for a session that is in
  // fact fine (hit 2026-07-30). Same lesson as isSalesRole() in fast-01.
  // poll every 200ms, not 1s: this check runs up to 25s and every extra step is
  // dead time the user watches (2026-07-30 feedback — login felt slow).
  const provLoggedIn = async (ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const ok = await provPage.evaluate(() =>
        [...document.querySelectorAll('.nav-title')].some(e => e.textContent.trim() === 'Result Dashboard')
        || /Busy Time/.test(document.body.innerText)).catch(() => false);
      if (ok) return true;
      if (Date.now() >= deadline) return false;
      await provPage.waitForTimeout(200);
    }
  };
  const dismissModals = () => provPage.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /^(Dismiss|Close|Cancel)$/.test(x.textContent.trim()))
      || document.querySelector('.swal-button--cancel');
    if (b && b.offsetParent) b.click();
    for (const x of document.querySelectorAll('.modal button.close, .modal .btn-close')) if (x.offsetParent) x.click();
  });

  if (!(await provLoggedIn(1200))) {
    await provPage.setViewportSize({ width: 1600, height: 1000 });
    // A blank/dead page only needs goto. The extra reload() is ONLY required
    // when the SPA is already mounted on a `#/` hash route (a plain goto does
    // not re-render it) — reloading a fresh page just pays the load cost twice.
    const mounted = /dnainsights/.test(provPage.url());
    await provPage.goto(CFG.url, { waitUntil: 'domcontentloaded' });
    if (mounted) await provPage.reload({ waitUntil: 'domcontentloaded' });
    await provPage.getByRole('textbox', { name: 'Username *' })
      .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await login(provPage, CFG.provEmail, CFG.provPassword);
    await dismissModals();
  }
  out.providerLoggedIn = await provLoggedIn(25000);
  if (!out.providerLoggedIn) {
    await provPage.screenshot({ path: './prov01c-login-failed.jpeg', type: 'jpeg', quality: 80 });
    out.error = 'provider login failed — check provider_account in provider-data.json';
    return out;
  }
  await dismissModals();

  const onCase = () => provPage.evaluate((c) => new RegExp('Case ID:\\s*' + c).test(document.body.innerText), CFG.caseId);

  // primary path: Task List search + TRUSTED card click (JS click does not open a card)
  if (!(await onCase())) {
    const search = provPage.getByRole('textbox', { name: 'Search case' });
    if (await search.count()) {
      await search.fill(CFG.caseId);
      await search.press('Enter');
      const card = provPage.locator('.gk-cases-wrapper').filter({ hasText: CFG.caseId }).first();
      if (await card.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) {
        await card.click().catch(() => {});
        out.opened = 'task-list-card';
        await provPage.waitForFunction((c) => new RegExp('Case ID:\\s*' + c).test(document.body.innerText),
          CFG.caseId, { timeout: 15000 }).catch(() => {});
      }
    }
  }
  // fallback: direct cid URL — valid ONLY because the case is already assigned.
  // goto alone does not re-render a hash route → reload afterwards.
  if (!(await onCase()) && CFG.cid) {
    await provPage.goto(CFG.url.replace(/#\/$/, '#/?cid=' + CFG.cid));
    await provPage.reload({ waitUntil: 'domcontentloaded' });
    // poll for the header instead of a blind 4s wait
    for (let i = 0; i < 30 && !(await onCase()); i++) await provPage.waitForTimeout(200);
    await dismissModals();
    out.opened = 'cid-url';
  }
  if (!(await onCase())) {
    await provPage.screenshot({ path: './prov01c-open-failed.jpeg', type: 'jpeg', quality: 80 });
    out.error = 'provider could not open ' + CFG.caseId + ' — is it assigned to this provider?';
    return out;
  }

  const head = await provPage.evaluate(() => document.body.innerText);
  const cut = head.indexOf('Case ID');
  out.caseId = CFG.caseId;
  out.badgeZone = (cut > 0 ? head.slice(Math.max(0, cut - 120), cut) : '').replace(/\s+/g, ' ').trim();
  out.status = (out.badgeZone.match(/\b(Assigned|Pending|New|Completed|Cancelled)\b/) || ['unknown'])[0];
  out.sectionsVisible = await provPage.evaluate(() =>
    [...document.querySelectorAll('strong')].map(s => s.textContent.trim())
      .filter(t => t && t.length < 45).slice(0, 30));
  await provPage.screenshot({ path: './prov01c-case-open.jpeg', type: 'jpeg', quality: 80 });
  out.ok = true;
  return out;
}
