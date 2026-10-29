// Walks the SWITCHING OFF FEES SOP end to end in a real browser against a running demo
// (npm run dev), plus the negative paths from the build spec. Resets the data first.
// Usage: npm test [screenshot-dir]. Set CHROME_PATH if Chrome is not in /Applications.
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer-core');
const { setProfile, applyLatency } = require('./lib/latency');

const OUT = process.argv[2] || path.join(__dirname, '..', 'test-output');
fs.mkdirSync(OUT, { recursive: true });
const WORKLIST = path.join(__dirname, '..', 'worklist', 'Split Fee Cases and Annuities Jul 2026.xlsx');
const B = 'http://localhost:4002', DATA = 'http://localhost:4000';

let n = 0, fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const text = (p, sel) => p.$eval(sel, e => (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) ? e.value : e.textContent).trim()).catch(() => null);
const shot = (p, name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` });
const nav = (p, fn) => Promise.all([p.waitForNavigation({ timeout: 30000 }), fn()]);
const step = (p, sel) => nav(p, () => p.click(sel));
const hdr = async p => `${await text(p, '#hdr-product-name')} / ${await text(p, '#hdr-status')} / ${await text(p, '#hdr-sub-status')}`;
const enabledBar = p => p.$$eval('#endorsement-action-bar button[id]', bs => bs.filter(b => !b.disabled).map(b => b.id));
const STEP_IDS = ['btn-create-refresh-layer', 'btn-calculate-premium', 'btn-start-sub-endorsement', 'btn-end-sub-endorsement', 'btn-lock-ebq', 'btn-finalise-endorsement'];
const enabledSteps = async p => (await enabledBar(p)).filter(id => STEP_IDS.includes(id));

async function readWorklist() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKLIST);
  const ws = wb.getWorksheet('S&I');
  const head = ws.getRow(1).values;
  const rows = [];
  ws.eachRow((r, i) => { if (i > 1) rows.push(Object.fromEntries(head.map((h, k) => [h, String(r.values[k] ?? '')]).filter(([h]) => h))); });
  return { sheets: wb.worksheets.map(w => w.name), active: wb.views[0].activeTab, rows };
}
const baseOf = () => B;
async function login(p, user) {
  await p.goto(B + '/login');
  await p.select('#login-user', user);
  await nav(p, () => p.click('#btn-login'));
}
async function search(p, contract) {
  await p.goto(baseOf(p) + '/policy-servicing/search');
  await p.type('#contract-no', contract);
  await nav(p, () => p.click('#btn-search'));
}
// Endorse/Alter: the Endorsement Initiation Screen is a modal over the policy screen, in the same tab.
async function endorse(p, contract) {
  await p.goto(`${B}/policy/${contract}?ctx=policy`);
  await step(p, '#btn-endorse-alter');
  await p.waitForSelector('#endorse-modal #endorsement-types-available');
  await p.select('#endorsement-types-available', 'Change Advisor Details');
  await p.click('#btn-move-right');
}
// Acceptance Details is a modal over the Acceptance screen, in the same tab.
async function accept(p, contract, date) {
  await p.goto(`${B}/policy/${contract}/acceptance`);
  const tabs = (await p.browser().pages()).length;
  await step(p, '#acceptance-serial-1');
  await p.waitForSelector('#acceptance-modal #acceptance-date');
  if (contract === '119900001001') {
    ok((await text(p, '#acceptance-modal-title')) === 'Acceptance Details' && p.url().endsWith('/acceptance/1') && (await p.browser().pages()).length === tabs, 'Acceptance Details opens as a modal in the same tab');
    await shot(p, 'acceptance-modal');
  }
  await p.select('#application-accepted', 'Yes');
  // The date field opens a calendar; picking a day fills it in DD/MM/YYYY.
  await p.click('#acceptance-date');
  if (contract === '119900001001') {
    ok(await p.$('#date-picker') !== null, 'clicking the Acceptance Date opens the calendar');
    await p.click('#date-picker .day.today');
    ok(/^\d{2}\/\d{2}\/\d{4}$/.test(await text(p, '#acceptance-date')) && await p.$('#date-picker') === null, `picking a day fills the field (${await text(p, '#acceptance-date')}) and closes the calendar`);
    await p.click('#acceptance-date', { clickCount: 3 });
  }
  await p.type('#acceptance-date', date);
  await step(p, '#btn-save');
}

(async () => {
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--host-resolver-rules=MAP *.whatfix.com ~NOTFOUND, MAP whatfix.com ~NOTFOUND'] });
  const restoreLatency = await setProfile(browser, 'off');   // no waits for the run; the previous table is put back at the end
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 1100, height: 620 });

  // Work list (Excel)
  const wl = await readWorklist();
  ok(wl.sheets.join('|') === 'OMEGA III|Annuities|OMEGA I|Flexcube|S&I' && wl.sheets[wl.active] === 'S&I', `workbook sheets ${wl.sheets.join(', ')}; opens on ${wl.sheets[wl.active]}`);
  const row = wl.rows.find(r => r.ContractNumber === '119900001001');
  const C = row.ContractNumber, listId = row['ID Number'], decl = row['Declaration Signed Date'];
  ok(/^\d{13}$/.test(listId) && /^\d{2}\/\d{2}\/\d{4}$/.test(decl), `S&I row: contract ${C}, ID ${listId}, declaration ${decl}`);

  // The case arrives by email, with the sheet attached; the contract, ID and declaration date in the email are the sheet's
  const mailPage = await browser.newPage();
  await mailPage.goto('http://localhost:4001/mail?user=nzwane&open=m1');
  const mailC = await text(mailPage, '#case-contract'), mailId = await text(mailPage, '#case-d-id'), mailDecl = await text(mailPage, '#case-d-declared');
  ok(mailC === C && mailId === listId && mailDecl === decl, `the case email gives contract ${mailC}, ID ${mailId}, declaration ${mailDecl}, the same as the sheet`);
  ok(await mailPage.$('#link-attachment') !== null && ((await text(mailPage, '#mailbox-role')) || '') === 'MAKER', 'it sits in the Maker\'s mailbox with the work list attached');
  const verifyBefore = (await (await fetch(DATA + '/mail?to=dvisser')).json()).length;
  ok(verifyBefore === 0, 'the Checker has nothing in their mailbox yet');

  // Capture: SOP steps 1-11
  await login(p, 'nzwane');
  ok((await text(p, '#welcome-user')).startsWith('Welcome') && (await text(p, '#user-role')) === 'SYS-ADMIN', 'header shows user name and SYS-ADMIN');
  await step(p, '#tile-business-operation');
  await step(p, '#topnav-policy-servicing');
  await p.type('#contract-no', C);
  await step(p, '#btn-search');
  ok((await p.$$('#search-results tbody tr')).length === 1, 'one result row');
  ok((await text(p, `#result-id-${C}`)) === listId, 'result ID number matches the work list');
  await step(p, `#result-link-${C}`);
  ok(await hdr(p) === 'OMS LISP Investment / ACTIVE POLICY / Active', `policy header: ${await hdr(p)}`);

  const tabs = (await browser.pages()).length;
  await endorse(p, C);
  ok((await text(p, '#endorse-modal-title')) === 'Endorsement Initiation Screen', 'Endorsement Initiation Screen opens as a modal');
  ok((await browser.pages()).length === tabs && p.url().endsWith(`/policy/${C}/endorse`), 'it is the same tab: no new window or tab');
  ok(await p.$('#policy-header') !== null && await p.$eval('#modal-error-band', () => true).catch(() => false) === false, 'policy screen stays behind the modal, no error');
  const greyed = await p.$$eval('#endorsement-types-available option[disabled]', os => os.length);
  ok(greyed >= 10, `picklist has ${greyed} greyed retrospective/underwriting types`);
  await shot(p, 'endorse-modal');
  await step(p, '#btn-save');
  ok(p.url().endsWith(`/policy/${C}`) && await p.$('#endorse-modal') === null, 'Save closes the modal and returns to the policy screen');
  ok(await hdr(p) === 'OMS LISP Investment / DRAFT ENDORSEMENT QUOTE / Sub-Endorsement Started', `header after endorse: ${await hdr(p)}`);
  const pbar = await enabledBar(p);
  ok(!pbar.includes('btn-finalise-endorsement') && !pbar.includes('btn-lock-ebq') && pbar.includes('btn-eac'), `policy action bar greys Finalise/Lock/End Sub (enabled: ${pbar.join(', ')})`);
  ok(await p.$('#nav-advisor-change') !== null, 'left nav includes Advisor Change');
  await shot(p, 'draft-action-bar');

  await step(p, '#nav-basic-details');
  ok((await text(p, '#vat-inclusive-asset-advice-fee')) === '0.575' && (await text(p, '#vat-exclusive-asset-advice-fee')) === '0.500', 'fee 0.575 / 0.500 before');
  await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 });
  await p.type('#vat-inclusive-asset-advice-fee', '0%');   // the SOP says "update to 0%"
  ok((await text(p, '#vat-exclusive-asset-advice-fee')) === '0.500' && await p.$eval('#vat-exclusive-asset-advice-fee', e => e.readOnly), 'VAT Exclusive is read-only and unchanged until Save');
  await p.$eval('#btn-save', e => e.scrollIntoView());
  await step(p, '#btn-save');
  ok((await text(p, '#vat-inclusive-asset-advice-fee')) === '0.000' && (await text(p, '#vat-exclusive-asset-advice-fee')) === '0.000', 'both fee fields read 0.000 after save');

  // Acceptance (SOP 12-13)
  await accept(p, C, decl);
  ok((await text(p, '#acceptance-value-1')) === 'Yes' && (await text(p, '#acceptance-date-1')) === decl && await p.$('#acceptance-modal') === null, 'Save closes the modal; the list shows Yes with the declaration date');

  // Endr Quote Summary (SOP 14-19): only the next step is enabled at each stage
  await step(p, '#nav-endr-quote-summary');
  const vis = await p.$eval('#endorsement-action-bar', e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  ok(vis, 'the action bar is pinned in view on load, without scrolling');
  const r = await fetch(`${DATA}/policies/${C}/endorsements/4/actions/lock-ebq`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'nzwane' }) }).then(x => x.json());
  ok(r.error && r.error.code === 30404, `server rejects Lock EBQ posted out of order: ${r.error && r.error.code}`);
  const expect = [
    ['#btn-create-refresh-layer', ['btn-create-refresh-layer']],
    ['#btn-calculate-premium', ['btn-calculate-premium']],
    ['#btn-end-sub-endorsement', ['btn-end-sub-endorsement']],
    ['#btn-lock-ebq', ['btn-start-sub-endorsement', 'btn-lock-ebq']],
    ['#btn-finalise-endorsement', ['btn-finalise-endorsement']]
  ];
  for (const [btn, enabled] of expect) {
    const now = await enabledSteps(p);
    ok(now.join(',') === enabled.join(','), `before ${btn}: enabled steps ${now.join(', ')}`);
    await p.$eval(btn, e => e.scrollIntoView());
    const t0 = Date.now();
    await step(p, btn);
    const err = await text(p, '#error-message');
    ok(!err, `${btn} (${Date.now() - t0}ms) -> ${await hdr(p)}${err ? ' ERROR ' + err : ''}`);
    if (btn === '#btn-create-refresh-layer') await shot(p, 'after-create-layer');
  }
  const after = await enabledBar(p);
  ok(after.join(',') === 'btn-reject-endorsed-quote,btn-follow-up-report', `after Finalise the bar is ${after.join(', ')}`);

  // Submission (SOP 20-21)
  await step(p, '#nav-endr-quote-submission');
  await step(p, '#btn-submit');
  ok((await text(p, '#error-message') || '').startsWith('48120'), `Submit with defaults rejected: ${await text(p, '#error-message')}`);
  await p.select('#admin-requirements-outstanding', '');
  await p.select('#underwriting-requirements-outstanding', '');
  await p.select('#all-admin-requirements-received', 'Accepted');
  await p.select('#reinsurance-verified', 'Yes');
  if (!(await text(p, '#legal-verification'))) await p.select('#legal-verification', 'Approved');
  await step(p, '#btn-save');
  await step(p, '#btn-submit');
  ok((await text(p, '#breadcrumb') || '').includes('Endr Quote Summary') && (await text(p, '#hdr-sub-status')) === 'Endorsement Submitted', `back on Endorsement Summary: ${await hdr(p)}`);

  ok((await enabledBar(p)).join(',') === 'btn-reject-endorsed-quote,btn-follow-up-report', 'a submitted quote shows Reject Endorsed Quote and Follow up report on the summary');
  const verifyMail = (await (await fetch(DATA + '/mail?to=dvisser')).json())[0];
  ok(verifyMail && verifyMail.kind === 'verify' && verifyMail.contractNo === C && verifyMail.serial === 4, 'Submit hands the case to the Checker: a verification email arrives in their mailbox');
  await mailPage.goto(`http://localhost:4001/mail?user=dvisser&open=${verifyMail.id}`);
  ok(((await text(mailPage, '#message-subject')) || '').includes('Please verify') && (await text(mailPage, '#case-quote')) === '1199000010010004' && (await text(mailPage, '#case-d-id')) === listId, 'the email names the quote and gives the ID number to check against');

  // Capturer cannot activate
  await step(p, '#hdr-policy-number');
  await step(p, '#nav-endorsement-quotes');
  await step(p, '#endr-serial-4');
  await step(p, '#nav-endr-quote-submission');
  await step(p, '#btn-activate');
  const sod = await text(p, '#error-message');
  ok(sod && sod.startsWith('71035*****'), `capturer Activate blocked: ${sod}`);

  // Verification by another person (SOP verification steps)
  const v = await (await browser.createBrowserContext()).newPage();
  await v.setViewport({ width: 1100, height: 620 });
  await login(v, 'dvisser');
  ok((await text(v, '#user-role')) === 'PREM-ADM', 'verifier header shows PREM-ADM');
  await search(v, C);
  ok((await text(v, `#result-id-${C}`)) === listId, 'verifier re-checks ID number against the work list');
  await step(v, `#result-link-${C}`);
  ok(!(await v.$('#nav-authorization')), 'no Authorization item: the SOP goes straight to Endorsement Quotes');
  await step(v, '#nav-endorsement-quotes');
  ok((await text(v, '#endr-row-4 .endr-type')) === 'Change Advisor Details', 'serial 4 is Change Advisor Details');
  await step(v, '#endr-serial-4');
  await step(v, '#nav-endr-quote-submission');
  ok((await text(v, '#hdr-sub-status')) === 'Endorsement Submitted', 'status shows Endorsement Submitted');
  await step(v, '#btn-activate');
  ok((await text(v, '#hdr-sub-status')) === 'Approved Endorsed Quote', `after Activate: ${await hdr(v)}`);
  await shot(v, 'approved');
  const approvedMail = (await (await fetch(DATA + '/mail?to=nzwane')).json())[0];
  ok(approvedMail && approvedMail.kind === 'approved' && approvedMail.contractNo === C, 'Activate closes the loop: the Maker gets an approval email');
  await mailPage.goto(`http://localhost:4001/mail?user=nzwane&open=${approvedMail.id}`);
  ok((await text(mailPage, '#case-fee-now')) === '0.000', 'the approval email shows the fee on the policy now: 0.000');
  await mailPage.close();
  await step(v, '#hdr-policy-number');
  await step(v, '#nav-basic-details');
  ok((await text(v, '#vat-inclusive-asset-advice-fee')) === '0.000', 'policy fee now 0.000');

  // Negative paths
  await search(p, '113901377001');
  await step(p, '#result-link-113901377001');
  await step(p, '#btn-endorse-alter');
  const e56 = await text(p, '#error-message');
  ok(e56 && e56.startsWith('56000*****: This transaction cannot be processed'), `56000 on future-dated policy: ${e56}`);
  await search(p, '113690412001');
  await step(p, '#result-link-113690412001');
  await step(p, '#nav-basic-details');
  ok((await text(p, '#vat-inclusive-asset-advice-fee')) === '0.000' && !(await text(p, '#error-message')), 'zero-fee policy reads 0.000 with no error');
  const mm = wl.rows.find(x => x.ContractNumber === '114137290001');
  await search(p, '114137290001');
  const bancsId = await text(p, '#result-id-114137290001');
  ok(mm['ID Number'] !== bancsId, `ID mismatch visible: work list ${mm['ID Number']} vs BaNCS ${bancsId}`);

  const L = '114250817001';
  await endorse(p, L);
  await step(p, '#btn-save');
  await accept(p, L, '01/08/2026');
  await p.goto(`${B}/policy/${L}/quote-summary`);
  for (const b of ['#btn-create-refresh-layer', '#btn-calculate-premium', '#btn-end-sub-endorsement', '#btn-lock-ebq', '#btn-finalise-endorsement']) await step(p, b);
  await step(p, '#nav-endr-quote-submission');
  ok((await text(p, '#legal-verification')) === '', 'Legal Verification defaults blank');
  await p.select('#all-admin-requirements-received', 'Accepted');
  await p.select('#reinsurance-verified', 'Yes');
  await step(p, '#btn-submit');
  ok((await text(p, '#error-message') || '').includes('Legal Verification must be Approved'), 'blank Legal Verification rejected');
  await p.select('#legal-verification', 'Approved');
  await step(p, '#btn-submit');
  ok((await text(p, '#hdr-sub-status')) === 'Endorsement Submitted', 'submit accepted once Approved');

  // Reset
  await p.goto(B + '/login');
  await nav(p, () => p.$eval('#form-reset-data', f => f.submit()));
  await login(p, 'nzwane');
  await p.goto(`${B}/policy/${C}?ctx=policy`);
  await step(p, '#nav-basic-details');
  ok((await text(p, '#vat-inclusive-asset-advice-fee')) === '0.575', 'after reset fee reads 0.575');

  await restoreLatency();
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
