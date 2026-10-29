// Walks the SAVINGS & INCOME - SWITCHING OFF FEES - SPLIT COMMISSION SOP in a real browser against
// a running demo (npm run dev). Resets the data first. Usage: npm run test:split [screenshot-dir].
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { setProfile, applyLatency } = require('./lib/latency');

const OUT = process.argv[2] || path.join(__dirname, '..', 'test-output', 'split');
fs.mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:4002', DATA = 'http://localhost:4000', C = '119900001001';
let n = 0, fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const text = (p, sel) => p.$eval(sel, e => (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) ? e.value : e.textContent).trim()).catch(() => null);
const shot = (p, name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` });
const step = (p, sel) => Promise.all([p.waitForNavigation({ timeout: 30000 }), p.click(sel)]);
const hdr = async p => `${await text(p, '#hdr-status')} / ${await text(p, '#hdr-sub-status')}`;
const err = p => text(p, '#modal-error-message').then(m => m || text(p, '#error-message'));
async function fill(p, i, advisor, primary, vals) {
  await p.select(`#share-advisor-${i}`, advisor);
  await p.select(`#share-primary-${i}`, primary);
  for (let k = 0; k < vals.length; k++) {
    await p.$eval(`#share-${i}-${k}`, e => { e.value = ''; });
    if (vals[k] !== '') await p.type(`#share-${i}-${k}`, String(vals[k]));
  }
}

(async () => {
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const advisers = await (await fetch(DATA + '/advisers')).json();
  const A1 = advisers.find(a => a.salesCode === '699001').partyCode;                 // current adviser, 100%
  const A2 = advisers.find(a => a.partyCode !== A1 && a.salesCode === '694653').partyCode; // new adviser
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--host-resolver-rules=MAP *.whatfix.com ~NOTFOUND, MAP whatfix.com ~NOTFOUND'] });
  const restoreLatency = await setProfile(browser, 'off');   // no waits for the run; the previous table is put back at the end
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 1280, height: 720 });
  await p.goto(B + '/login'); await p.select('#login-user', 'nzwane'); await step(p, '#btn-login');

  // Capture: search, open, Endorse/Alter, Change Advisor Details
  await p.goto(`${B}/policy/${C}?ctx=policy`);
  await step(p, '#btn-endorse-alter');
  await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  ok((await hdr(p)) === 'DRAFT ENDORSEMENT QUOTE / Sub-Endorsement Started', `draft endorsement: ${await hdr(p)}`);

  // Advisor Change screen
  await step(p, '#nav-advisor-change');
  ok((await text(p, '#breadcrumb')).endsWith('Advisor Change') && await p.$('#btn-edit-contribution-sharing') !== null && await p.$('#btn-edit-asset-sharing') !== null, 'Advisor Change shows Edit Contribution / Asset Remuneration Sharing');
  await shot(p, 'advisor-change');

  // Contribution sharing: existing row greyed, Add gives a blank record
  await step(p, '#btn-edit-contribution-sharing');
  ok(await p.$('#sharing-modal') !== null && p.url().endsWith('/sharing/contribution'), 'Edit Contribution Remuneration Sharing opens as a modal, same tab');
  ok((await p.$$('#sharing-table tr.old-row')).length === 1 && (await p.$$('#sharing-table tr.new-row')).length === 0, 'existing adviser shown greyed (OLD), no new rows yet');
  await step(p, '#btn-share-add');
  ok((await p.$$('#sharing-table tr.new-row')).length === 1 && (await text(p, '#share-advisor-0')) === '', 'Add displays a blank record');
  await shot(p, 'contribution-blank-row');

  // Rules inside the dialog
  await step(p, '#btn-share-save');
  ok((await err(p) || '').startsWith('56303'), `blank adviser refused: ${(await err(p) || '').slice(0, 70)}`);
  await fill(p, 0, A1, 'Yes', [50, 50, 50, 50]);
  await step(p, '#btn-share-save');
  ok((await err(p) || '').startsWith('56309'), `50% alone refused: ${(await err(p) || '').slice(0, 90)}`);
  await step(p, '#btn-share-add');
  await fill(p, 1, A2, 'Yes', [50, 50, 50, 50]);
  await step(p, '#btn-share-save');
  ok((await err(p) || '').startsWith('56308'), `two primary advisers refused: ${(await err(p) || '').slice(0, 70)}`);
  await p.select('#share-primary-1', 'No');
  await shot(p, 'contribution-split-50-50');
  await step(p, '#btn-share-save');
  ok(p.url().endsWith('/advisor-change') && await p.$('#sharing-modal') === null, 'valid 50/50 Save closes the dialog back to Advisor Change');

  // Asset sharing
  await step(p, '#btn-edit-asset-sharing');
  ok((await p.$$('#sharing-table th')).length > 8, 'Edit Asset Remuneration Sharing opens with its own columns');
  await step(p, '#btn-share-add');
  await fill(p, 0, A1, 'Yes', ['', '', 50, 50, '', '']);
  await step(p, '#btn-share-add');
  await fill(p, 1, A2, 'No', ['', '', 50, 50, '', '']);
  await shot(p, 'asset-split-50-50');
  await step(p, '#btn-share-save');
  ok(p.url().endsWith('/advisor-change'), 'asset 50/50 saved');

  // Delete removes only ticked rows
  await step(p, '#btn-edit-asset-sharing');
  await p.click('#share-select-1'); await step(p, '#btn-share-delete');
  ok((await p.$$('#sharing-table tr.new-row')).length === 1, 'Delete removes the ticked record');
  await step(p, '#btn-share-add'); await fill(p, 1, A2, 'No', ['', '', 50, 50, '', '']); await step(p, '#btn-share-save');

  // Save on the Advisor Change screen commits what the dialogs staged
  await step(p, '#btn-save');                       // Advisor Change > Save
  ok(!(await err(p)), 'Save on Advisor Change commits the split');

  // The fee follows the split: Save on Advisor Change works it out (0.575 x 50% -> 0.287) and stages it
  await step(p, '#nav-basic-details');
  ok((await text(p, '#vat-inclusive-asset-advice-fee')) === '0.287' && (await text(p, '#vat-exclusive-asset-advice-fee')) === '0.250', 'Basic Details already shows the calculated fee: 0.287 / 0.250');
  // ... and a wrong fee is still refused, with the right number in the message
  await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0.5');
  await step(p, '#btn-save');
  await step(p, '#nav-endr-quote-summary');
  await step(p, '#btn-create-refresh-layer');
  await step(p, '#btn-calculate-premium');
  ok((await err(p) || '').startsWith('30409'), `Calculate Premium refused for a wrong fee: ${(await err(p) || '').slice(0, 140)}`);
  // Basic Details: new fee, VAT exclusive derived
  await step(p, '#nav-basic-details');
  await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0.287');
  await step(p, '#btn-save');
  ok((await text(p, '#vat-inclusive-asset-advice-fee')) === '0.287' && (await text(p, '#vat-exclusive-asset-advice-fee')) === '0.250', 'fee 0.287 inclusive / 0.250 exclusive after save');

  // Acceptance, summary steps, submission
  await p.goto(`${B}/policy/${C}/acceptance`);
  await step(p, '#acceptance-serial-1');
  await p.select('#application-accepted', 'Yes'); await p.type('#acceptance-date', '04/08/2026'); await step(p, '#btn-save');
  await step(p, '#nav-endr-quote-summary');                 // the layer was already created above
  for (const b of ['#btn-calculate-premium', '#btn-end-sub-endorsement', '#btn-lock-ebq', '#btn-finalise-endorsement']) {
    await step(p, b);
    ok(!(await err(p)), `${b} -> ${await hdr(p)}`);
  }
  await step(p, '#nav-endr-quote-submission');
  await p.select('#all-admin-requirements-received', 'Accepted'); await p.select('#reinsurance-verified', 'Yes');
  await step(p, '#btn-submit');
  ok((await text(p, '#hdr-sub-status')) === 'Endorsement Submitted', `submitted: ${await hdr(p)}`);
  await shot(p, 'submitted');

  // Verifier activates; the split lands on the policy
  const v = await (await browser.createBrowserContext()).newPage(); await v.setViewport({ width: 1280, height: 720 });
  await v.goto(B + '/login'); await v.select('#login-user', 'dvisser'); await step(v, '#btn-login');
  await v.goto(`${B}/policy/${C}?ctx=policy`); await step(v, '#nav-endorsement-quotes');
  await step(v, '#endr-serial-1'); await step(v, '#nav-endr-quote-submission'); await step(v, '#btn-activate');
  ok((await text(v, '#hdr-sub-status')) === 'Approved Endorsed Quote', `activated: ${await hdr(v)}`);
  const after = await (await fetch(`${DATA}/policies/${C}`)).json();
  ok(after.advisers.length === 2 && after.advisers.find(a => a.partyCode === A1).share === 50 && after.advisers.find(a => a.partyCode === A2).share === 50 && after.advisers.find(a => a.partyCode === A1).primary, 'policy now has the 50/50 split with the first adviser primary');
  ok(Number(after.fee.vatInclusive) === 0.287 && Number(after.fee.vatExclusive) === 0.25, 'policy fee updated to 0.287 / 0.250');
  await v.goto(`${B}/policy/${C}?ctx=policy`); await step(v, '#nav-adviser-info');
  ok((await v.$$eval('table.grid tbody tr', r => r.length)) === 2, 'Adviser Info lists both advisers');

  // Finalise guard: staged-but-unsaved changes block Finalise
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const q = await (await browser.createBrowserContext()).newPage(); await q.setViewport({ width: 1280, height: 720 });
  await q.goto(B + '/login'); await q.select('#login-user', 'nzwane'); await step(q, '#btn-login');
  await q.goto(`${B}/policy/${C}/endorse`); await q.select('#endorsement-types-available', 'Change Advisor Details'); await q.click('#btn-move-right'); await step(q, '#btn-save');
  await q.goto(`${B}/policy/${C}/sharing/contribution`); await step(q, '#btn-share-add');
  await fill(q, 0, A2, 'Yes', [100, 100, 100, 100]); await step(q, '#btn-share-save');
  await q.goto(`${B}/policy/${C}/acceptance`); await step(q, '#acceptance-serial-1'); await q.select('#application-accepted', 'Yes'); await q.type('#acceptance-date', '04/08/2026'); await step(q, '#btn-save');
  await q.goto(`${B}/policy/${C}/quote-summary`);
  for (const b of ['#btn-create-refresh-layer', '#btn-calculate-premium', '#btn-end-sub-endorsement', '#btn-lock-ebq', '#btn-finalise-endorsement']) await step(q, b);
  const g = await err(q);
  ok(g && g.startsWith('30408'), `Finalise blocked while Advisor Change is unsaved: ${(g || '').slice(0, 70)}`);

  await restoreLatency();
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
