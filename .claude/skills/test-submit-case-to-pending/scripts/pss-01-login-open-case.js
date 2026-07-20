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
  const isPssRole = () => page.evaluate(() =>
    !!document.querySelector('[title="Call Scoring"]')
    || [...document.querySelectorAll('.nav-title')].some(e => e.textContent.trim() === 'Call Scoring'));

  await page.goto(CFG.url);
  await page.waitForTimeout(2000);
  await doLogin();

  if (!(await searchVisible()) || !(await isPssRole())) {
    // stale session with another role → hard logout and retry once
    out.hadStaleSession = true;
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.context().clearCookies();
    await page.goto(CFG.url);
    await page.waitForTimeout(2000);
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
