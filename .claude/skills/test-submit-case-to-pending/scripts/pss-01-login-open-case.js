// pss-01: login with the PSS account → search the case in the Task List →
// open the first result → VERIFY the header Case ID matches.
// Run via mcp__playwright__browser_run_code_unsafe: Read this file, replace
// __CONFIG__ with { url, email, password, caseId }, pass as `code`.
async (page) => {
  const CFG = __CONFIG__;
  const out = { stage: 'pss-login-open-case', ok: false };

  const doLogin = async () => {
    const userBox = page.getByRole('textbox', { name: 'Username *' });
    if (await userBox.count()) {
      await userBox.fill(CFG.email);
      await page.getByRole('textbox', { name: 'Password *' }).fill(CFG.password);
      await page.getByRole('button', { name: 'Continue' }).click();
    }
  };
  const searchVisible = () => page.getByRole('textbox', { name: 'Search case' })
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  // PSS-role check: sales/doctor sessions ALSO have a "Search case" box, and
  // sessions persist across skills. Only the PSS nav has "Call Scoring".
  // POLL, never single-shot: the nav renders several seconds AFTER the Task List
  // (same false-negative as fast-01, 2026-07-29).
  const until = async (fn, timeoutMs = 8000, everyMs = 150) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn().catch(() => false);
      if (v) return v;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(everyMs);
    }
  };
  // SPEED: resolve the role from whichever marker appears first (200ms polling)
  // instead of polling 20s at 1s intervals for "Call Scoring" alone — a stale
  // sales/provider session used to cost the full 20s before the retry started.
  const whoAmI = (timeoutMs = 20000) => until(() => page.evaluate(() => {
    const navs = [...document.querySelectorAll('.nav-title')].map(e => e.textContent.trim());
    if (document.querySelector('[title="Call Scoring"]') || navs.includes('Call Scoring')) return 'pss';
    if (navs.includes('Sales Report')) return 'sales';
    if (navs.includes('Result Dashboard') || /\+ Busy Time/.test(document.body.innerText)) return 'provider';
    return false;
  }), timeoutMs, 200);
  const isPssRole = async (timeoutMs = 20000) => (await whoAmI(timeoutMs)) === 'pss';

  await page.goto(CFG.url);
  await until(() => page.evaluate(() =>
    !!document.querySelector('input[type="password"]') || !!document.querySelector('.nav-title')), 15000);
  await doLogin();

  out.sessionRole = (await whoAmI(20000)) || 'unknown';
  if (out.sessionRole !== 'pss') {
    // stale session with another role → hard logout and retry once.
    // goto() alone on a hash URL does NOT re-render the SPA → the login form
    // never appears and doLogin() no-ops (see fast-01, 2026-07-27). Reload and
    // wait for the Username box before logging in.
    out.hadStaleSession = true;
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    await page.context().clearCookies();
    await page.goto(CFG.url);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Username *' })
      .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await doLogin();
    if (!(await searchVisible()) || !(await isPssRole())) {
      await page.screenshot({ path: './pss-login-error.jpeg', type: 'jpeg', quality: 90 });
      out.error = 'Task List "Search case" / "Call Scoring" nav not visible after fresh login — check pss_account in pss-data.json.';
      return out;
    }
  }
  await page.evaluate(() => {
    const b = document.querySelector('.swal-button--cancel, .swal2-cancel');
    if (b && b.offsetParent) b.click();
  });
  out.loggedIn = true;

  // search the case id and open the first matching card
  const search = page.getByRole('textbox', { name: 'Search case' });
  await search.fill(CFG.caseId);
  await search.press('Enter');

  // results render async — poll up to 10s for a card matching the case id.
  // NOTE: case cards need a TRUSTED Playwright click — a JS el.click() does
  // NOT trigger the card's open handler (learned 2026-07-10).
  const card = page.locator('.gk-cases-wrapper').filter({ hasText: CFG.caseId }).first();
  const found = await card.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
  if (!found) {
    await page.screenshot({ path: './pss-search-empty.jpeg', type: 'jpeg', quality: 90 });
    out.error = 'No case card found for ' + CFG.caseId + ' — check the case id / environment.';
    return out;
  }
  await card.click();
  out.cardClicked = 'matched-card';

  // VERIFY the opened case header shows the expected Case ID
  const matched = await page.waitForFunction(
    (cid) => new RegExp('Case ID:\\s*' + cid).test(document.body.innerText),
    CFG.caseId, { timeout: 15000 }
  ).then(() => true).catch(() => false);
  if (!matched) {
    await page.screenshot({ path: './pss-case-mismatch.jpeg', type: 'jpeg', quality: 90 });
    out.error = 'Opened case header does not show Case ID ' + CFG.caseId + ' — wrong case opened, aborting.';
    return out;
  }

  const head = await page.evaluate(() => document.body.innerText.slice(0, 300));
  out.caseId = CFG.caseId;
  out.patientId = (head.match(/PT-\d+/) || [null])[0];
  out.status = (head.match(/\b(New|Draft|Assigned|Pending)\b/) || ['unknown'])[0];
  out.ok = true;
  return out;
}
