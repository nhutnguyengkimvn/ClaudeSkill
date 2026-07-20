// fast-04: final step — log the sale account out and verify the login page.
// No placeholders — run via mcp__playwright__browser_run_code_unsafe with
// {filename: "<abs path to this file>"} directly.
//
// The logout button is the account-dropdown button whose icon is
// `i.fa-right-from-bracket` (bottom-left "Account" cluster, next to "Online").
// It is sometimes already visible in the DOM; otherwise open the account
// dropdown first. JS-click only (sidebar overlays intercept trusted clicks).
async (page) => {
  const out = { stage: 'logout', ok: false };

  // NOTE: do NOT require offsetParent — the logout button lives inside the
  // hidden .gk-mobile-user-account dropdown and a JS click works while hidden.
  let clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('i.fa-right-from-bracket'));
    if (btn) { btn.click(); return true; } return false;
  });
  if (!clicked) {
    // open the account dropdown (chevron next to "Online"), then retry
    await page.evaluate(() => {
      const toggles = [...document.querySelectorAll('button.dropdown-tog, .dropdown-tog')].filter(e => e.offsetParent);
      toggles.forEach(t => { if (!t.querySelector('i.fa-bell') && !t.querySelector('i.fa-gear')) t.click(); });
      const online = [...document.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === 'Online')).pop();
      online?.parentElement?.click();
    });
    await page.waitForTimeout(1000);
    clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('i.fa-right-from-bracket') && b.offsetParent);
      if (btn) { btn.click(); return true; } return false;
    });
  }
  out.clicked = clicked;
  if (!clicked) { out.error = 'Logout button (i.fa-right-from-bracket) not found'; return out; }

  // confirm any "are you sure" dialog
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const yes = [...document.querySelectorAll('.swal-modal button, .swal2-popup button')].find(b => ['Yes', 'OK'].includes(b.textContent.trim()) && b.offsetParent);
    yes?.click();
  });

  // verify: login form appears
  out.ok = await page.getByRole('textbox', { name: 'Username *' })
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (!out.ok) {
    out.error = 'Login page did not appear after logout click';
    await page.screenshot({ path: './fast-logout-failed.jpeg', type: 'jpeg', quality: 90 });
  }
  return out;
}
