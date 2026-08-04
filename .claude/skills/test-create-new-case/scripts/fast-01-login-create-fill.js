// fast-01: login → + Create case → fill Eligibility Check (page 1) → Continue →
// fill Personal Information (page 2) → VERIFY every field → Save (creates the case).
// Run via mcp__playwright__browser_run_code_unsafe: Read this file, replace the
// __CONFIG__ placeholder with the real JSON object, pass the result as `code`.
// CONFIG shape: { url, email, password, medicareId, patient: {...}, additional: {...} }
//
// Safety rules:
// - NEVER Save unverified data: both pages are read back and compared to CFG;
//   any mismatch aborts BEFORE Save with a `mismatches` list.
// - If the URL already has ?cid= a case is already open (crashed earlier run)
//   → abort so the caller resumes with fast-02 instead of creating a duplicate.
// - Wrong-role session (no "+ Create case") → hard logout (clear storage +
//   cookies) and one fresh login attempt before giving up.
async (page) => {
  const CFG = __CONFIG__;
  const out = { stage: 'login-create-fill', ok: false };
  const p = CFG.patient;
  const digits = (s) => (s || '').replace(/\D/g, '');

  const dismissSwal = async () => {
    await page.evaluate(() => {
      const b = document.querySelector('.swal-button--cancel, .swal2-cancel');
      if (b && b.offsetParent) b.click();
    });
  };
  const clearInput = (loc) => loc.evaluate((el) => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const doLogin = async () => {
    const userBox = page.getByRole('textbox', { name: 'Username *' });
    if (await userBox.count()) {
      await userBox.fill(CFG.email);
      await page.getByRole('textbox', { name: 'Password *' }).fill(CFG.password);
      await page.getByRole('button', { name: 'Continue' }).click();
    }
  };
  const until = async (fn, timeoutMs = 8000, everyMs = 150) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn().catch(() => false);
      if (v) return v;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(everyMs);
    }
  };
  const createBtnVisible = () => page.getByRole('button', { name: /Create case/ })
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  // SALES-role check: PSS sessions ALSO show "+ Create case" (and PSS stays
  // logged in — that skill does not log out). Only the sales nav has a
  // "Sales Report" item; without this check a stale PSS session would create
  // the case under the WRONG account.
  // POLL, never single-shot: the nav renders several seconds AFTER the Task List,
  // so a one-shot check right after login reports "not sales" for a perfectly
  // valid sales session and the run aborts for nothing (hit 2026-07-29).
  // SPEED: decide as soon as ANY role marker renders. The old version polled a
  // full 20s at 1s intervals for "Sales Report" alone, so a stale PSS session —
  // which happens on EVERY core-flow run, because step 2 deliberately leaves PSS
  // logged in — burned 20s before the hard-logout path even started. Watching
  // for the foreign-role markers too makes that decision take ~1s.
  const whoAmI = async (timeoutMs = 20000) => until(() => page.evaluate(() => {
    const navs = [...document.querySelectorAll('.nav-title')].map(e => e.textContent.trim());
    if (document.querySelector('[title="Sales Report"]') || navs.includes('Sales Report')) return 'sales';
    if (navs.includes('Call Scoring')) return 'pss';
    if (navs.includes('Result Dashboard') || /\+ Busy Time/.test(document.body.innerText)) return 'provider';
    return false;
  }), timeoutMs, 200);
  const isSalesRole = async (timeoutMs = 20000) => (await whoAmI(timeoutMs)) === 'sales';

  await page.goto(CFG.url);
  // poll for whichever lands first: the login form or an existing session
  await until(() => page.evaluate(() =>
    !!document.querySelector('input[name="username"], input[type="password"]')
    || [...document.querySelectorAll('button')].some(b => /Create case/.test(b.textContent))
    || !!document.querySelector('.nav-title')), 15000);
  if (/cid=/.test(page.url())) {
    out.error = 'A case is already open (?cid= in URL) — resume with fast-02, do NOT re-create.';
    return out;
  }
  await doLogin();

  // One role probe decides everything: 'sales' → go; 'pss'/'provider' → the
  // session belongs to another account, wipe it immediately (no 20s wait).
  const role = await whoAmI(20000);
  out.sessionRole = role || 'unknown';
  if (role !== 'sales') {
    // stale session with the wrong role → hard logout and retry once.
    // A plain goto() on a hash URL does NOT re-render the SPA, so the login
    // form never appears and doLogin() no-ops → the stale session survives
    // (hit 2026-07-27). A real reload + waiting for the Username box is required.
    out.hadWrongRoleSession = true;
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    await page.context().clearCookies();
    await page.goto(CFG.url);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Username *' })
      .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await doLogin();
    if (!(await createBtnVisible()) || !(await isSalesRole())) {
      await page.screenshot({ path: './fast-create-case-error.jpeg', type: 'jpeg', quality: 90 });
      out.error = 'No "+ Create case" button / no Sales Report nav after fresh login — account is not a SALE account. Check sale_account in case-data.json.';
      return out;
    }
  }
  await dismissSwal();
  // JS-dispatch: the collapsed nav sidebar overlays the button box.
  // POLL for an ENABLED button: right after a fresh login the Task List is
  // still loading and "+ Create case" stays `disabled` for a few seconds
  // (hit 2026-07-29 — a single-shot check aborted the run for nothing).
  let createClicked = false;
  for (let i = 0; i < 30 && !createClicked; i++) {
    createClicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /Create case/.test(b.textContent) && !b.disabled);
      if (btn) { btn.click(); return true; } return false;
    });
    if (!createClicked) await page.waitForTimeout(1000);
  }
  if (!createClicked) {
    out.error = '"+ Create case" button stayed disabled for 30s — Task List never finished loading.';
    return out;
  }
  out.loggedIn = true;

  // ---- Page 1: Eligibility Check ----
  const first = page.getByRole('textbox', { name: "Patient's First Name *" });
  await first.waitFor({ timeout: 15000 });
  await first.fill(p.first_name);
  await page.getByRole('textbox', { name: "Patient's Last Name *" }).fill(p.last_name);
  if (p.middle_initial) await page.getByRole('textbox', { name: 'M.I' }).fill(p.middle_initial);
  await page.getByRole('textbox', { name: /Phone Number/ }).first().pressSequentially(digits(p.phone_number));
  await page.locator('.form-control.input').first().pressSequentially(p.date_of_birth);
  await page.getByRole('textbox', { name: 'Zip Code *' }).pressSequentially(digits(p.zip_code));
  const state = page.getByRole('textbox', { name: 'State *' });
  await clearInput(state);
  await state.pressSequentially(p.state);
  await page.locator('label').filter({ hasText: 'Medicare' }).first().click();
  await page.getByRole('textbox', { name: 'Primary Insurance *' }).fill(p.primary_insurance);
  await page.getByRole('textbox', { name: 'Primary Policy # *' }).fill(CFG.medicareId);
  if (p.primary_group_number) await page.getByRole('textbox', { name: 'Primary Group #' }).fill(p.primary_group_number);
  await page.getByRole('checkbox', { name: 'No Secondary Insurance' }).check();

  // ---- VERIFY page 1 before Continue ----
  const val = (name) => page.getByRole('textbox', { name }).first().inputValue().catch(() => null);
  const m1 = [];
  const expect1 = [
    ["Patient's First Name *", p.first_name, (a, b) => a === b],
    ["Patient's Last Name *", p.last_name, (a, b) => a === b],
    ['Zip Code *', p.zip_code, (a, b) => digits(a) === digits(b)],
    ['State *', p.state, (a, b) => a === b],
    ['Primary Insurance *', p.primary_insurance, (a, b) => a === b],
    ['Primary Policy # *', CFG.medicareId, (a, b) => a === b],
  ];
  for (const [name, want, eq] of expect1) {
    const got = await val(name);
    if (!eq(got, want)) m1.push({ field: name, want, got });
  }
  const phoneGot = await page.getByRole('textbox', { name: /Phone Number/ }).first().inputValue();
  if (digits(phoneGot) !== digits(p.phone_number)) m1.push({ field: 'Phone', want: p.phone_number, got: phoneGot });
  const dobGot = await page.locator('.form-control.input').first().inputValue();
  if (dobGot !== p.date_of_birth) m1.push({ field: 'DOB', want: p.date_of_birth, got: dobGot });
  if (!(await page.getByRole('radio', { name: 'Medicare' }).isChecked())) m1.push({ field: 'Primary Insurance Type', want: 'Medicare checked' });
  if (!(await page.getByRole('checkbox', { name: 'No Secondary Insurance' }).isChecked())) m1.push({ field: 'No Secondary Insurance', want: 'checked' });
  if (m1.length) {
    out.error = 'Page 1 verification failed — NOT saved'; out.mismatches = m1;
    await page.screenshot({ path: './fast-page1-mismatch.jpeg', type: 'jpeg', quality: 90 });
    return out;
  }
  out.page1 = 'verified';

  // The Eligibility Check runs on Continue. While it is in flight the click is
  // SWALLOWED, and a failed/slow check paints a red "Inactive Insurance" banner
  // in the panel header (hit 2026-07-29 with a policy # that had worked before).
  // The banner is NOT fatal: clicking Continue again once the check settles goes
  // through. Retry up to 3× before giving up.
  // The click itself must be CAUGHT and given a short timeout: while the
  // eligibility check is in flight the button goes `disabled`, Playwright waits
  // for it to become enabled, and the default 30s timeout THROWS out of the
  // retry loop — which is what killed the chained run on 2026-07-30 (65s, phase
  // 1, "locator.click: Timeout 30000ms exceeded ... Continue").
  let onPage2 = false;
  for (let i = 0; i < 4 && !onPage2; i++) {
    await page.getByRole('button', { name: 'Continue' })
      .click({ timeout: 6000 }).catch(() => {});
    onPage2 = await page.getByText('PERSONAL INFORMATION').first()
      .waitFor({ timeout: 12000 }).then(() => true).catch(() => false);
    if (!onPage2) {
      out.eligibilityNotice = await page.evaluate(() =>
        [...document.querySelectorAll('.formio-errors, .error, .invalid-feedback, .text-danger')]
          .map(e => e.textContent.trim()).filter(Boolean));
      await page.waitForTimeout(3000);
    }
  }
  if (!onPage2) {
    out.error = 'Continue did not reach page 2 after 3 attempts (eligibility check)';
    await page.screenshot({ path: './fast-continue-blocked.jpeg', type: 'jpeg', quality: 90 });
    return out;
  }

  // ---- Page 2: Personal Information ----
  await page.getByRole('radio', { name: p.gender, exact: true }).check({ force: true });
  for (const eth of p.ethnicity) await page.getByRole('checkbox', { name: eth, exact: true }).check({ force: true });
  if (p.social_security_number) await page.getByRole('textbox', { name: 'Social Security Number' }).fill(p.social_security_number);
  await page.getByRole('textbox', { name: 'ft.' }).fill(p.height_ft);
  await page.getByRole('textbox', { name: 'in.' }).fill(p.height_in);
  await page.getByRole('textbox', { name: /Weight \(lb\.\)/ }).fill(p.weight_lb);
  if (p.email) await page.getByRole('textbox', { name: "Patient's Email Address" }).fill(p.email);
  await page.getByRole('radio', { name: p.phone_number_type }).check({ force: true });
  await page.getByRole('textbox', { name: 'Street Address *' }).fill(p.street_address);
  if (p.apt_suite) await page.getByRole('textbox', { name: /Apt, Suite/ }).fill(p.apt_suite);
  for (const [label, v] of [['City *', p.city], ['Country *', p.country]]) {
    const box = page.getByRole('textbox', { name: label });
    if (!(await box.inputValue())) await box.fill(v);
  }
  await page.getByRole('combobox').first().click();
  await page.locator('.choices__list--dropdown [role="option"]').filter({ hasText: CFG.additional.reason_of_visit }).first().click();
  // the RPM select renders only after Reason of Visit is set — poll for a 2nd combobox
  await until(() => page.getByRole('combobox').count().then(n => n > 1), 6000);
  if (CFG.additional.rpm_service) {
    const rpmMap = { 'CGM/BGM': 'CGM or BGM' };
    const rpmText = rpmMap[CFG.additional.rpm_service] || CFG.additional.rpm_service;
    await page.getByRole('combobox').last().click();
    await page.locator('.choices__list--dropdown [role="option"]').filter({ hasText: rpmText }).first().click();
  }

  // ---- VERIFY page 2 before Save ----
  const m2 = [];
  if (!(await page.getByRole('radio', { name: p.gender, exact: true }).isChecked())) m2.push({ field: 'Gender', want: p.gender });
  for (const eth of p.ethnicity) {
    if (!(await page.getByRole('checkbox', { name: eth, exact: true }).isChecked())) m2.push({ field: 'Ethnicity', want: eth });
  }
  if ((await val('ft.')) !== p.height_ft) m2.push({ field: 'Height ft', want: p.height_ft });
  if ((await val('in.')) !== p.height_in) m2.push({ field: 'Height in', want: p.height_in });
  const wGot = await page.getByRole('textbox', { name: /Weight \(lb\.\)/ }).inputValue();
  if (wGot !== p.weight_lb) m2.push({ field: 'Weight', want: p.weight_lb, got: wGot });
  if (!(await page.getByRole('radio', { name: p.phone_number_type }).isChecked())) m2.push({ field: 'Phone Type', want: p.phone_number_type });
  if ((await val('Street Address *')) !== p.street_address) m2.push({ field: 'Street', want: p.street_address });
  const combosOk = await page.evaluate((wantReason) => {
    const items = [...document.querySelectorAll('.choices__list--single .choices__item')].map(e => e.textContent.trim());
    return items.some(t => t.includes(wantReason));
  }, CFG.additional.reason_of_visit);
  if (!combosOk) m2.push({ field: 'Reason of Visit', want: CFG.additional.reason_of_visit });
  if (m2.length) {
    out.error = 'Page 2 verification failed — NOT saved'; out.mismatches = m2;
    await page.screenshot({ path: './fast-page2-mismatch.jpeg', type: 'jpeg', quality: 90 });
    return out;
  }
  out.page2 = 'verified';

  await page.getByRole('button', { name: 'Save' }).last().click();
  await page.waitForURL(/cid=/, { timeout: 30000 });
  // poll for the header IDs instead of a blind 3s wait
  await until(() => page.evaluate(() => /CA-[A-Z0-9]{8}/.test(document.body.innerText)), 15000);

  const body = await page.evaluate(() => document.body.innerText);
  out.caseId = (body.match(/CA-[A-Z0-9]{8}/) || [null])[0];
  out.patientId = (body.match(/PT-\d+/) || [null])[0];
  out.ok = !!out.caseId;
  return out;
}
