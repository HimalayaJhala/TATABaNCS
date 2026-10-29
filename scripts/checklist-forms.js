// Checks that the dropdowns and calculations behave as the business process needs: search filters,
// the Endorsement Initiation modal, Basic Details edits, and the split-fee rule. Needs the demo running.
const path = require('path');
const puppeteer = require('puppeteer-core');
const { setProfile, applyLatency } = require('./lib/latency');
const MAIL = 'http://localhost:4001';

const B = 'http://localhost:4002', DATA = 'http://localhost:4000', C = '119900001001';
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const text = (p, sel) => p.$eval(sel, e => (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) ? e.value : e.textContent).trim()).catch(() => null);
const step = (p, sel) => Promise.all([p.waitForNavigation({ timeout: 30000 }), p.click(sel)]);
const results = p => p.$$eval('#search-results tbody td:first-child a', as => as.map(a => a.textContent.trim()));
async function search(p, fields) {
  await p.goto(B + '/policy-servicing/search');
  for (const [sel, v] of Object.entries(fields)) {
    if (await p.$eval(sel, e => e.tagName) === 'SELECT') await p.select(sel, v); else await p.type(sel, v);
  }
  await step(p, '#btn-search');
  return results(p);
}

(async () => {
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--host-resolver-rules=MAP *.whatfix.com ~NOTFOUND, MAP whatfix.com ~NOTFOUND'] });
  const restoreLatency = await setProfile(browser, 'off');   // no waits for the run; the previous table is put back at the end
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 1280, height: 800 });
  await p.goto(B + '/login'); await p.select('#login-user', 'nzwane'); await step(p, '#btn-login');

  // ---- Search dropdowns ----
  let r = await search(p, { '#contract-no': '1144932' });
  ok(r.length === 0, 'Contract No. "1144932" alone matches nothing (default is an exact match)');
  r = await search(p, { '#contract-no': '1199000', '#parameter': 'Starts with' });
  ok(r.join() === '119900001001', 'Parameter "Starts with" finds 119900001001 from the first digits');
  r = await search(p, { '#contract-no': '900001', '#parameter': 'Contains' });
  ok(r.join() === '119900001001', 'Parameter "Contains" finds it from the middle digits');
  r = await search(p, { '#contract-no': '1199000%' });
  ok(r.join() === '119900001001', 'a trailing % is a wildcard, as in the SOP screenshot');
  r = await search(p, { '#status': 'DRAFT ENDORSEMENT QUOTE' });
  ok(r.join() === '114020658001', `Status DRAFT ENDORSEMENT QUOTE finds the policy with an open draft (${r.join()})`);
  r = await search(p, { '#status': 'REJECTED ENDORSEMENT QUOTE' });
  ok(r.length === 0, `Status REJECTED ENDORSEMENT QUOTE finds nothing until a quote is rejected (${r.join()})`);
  r = await search(p, { '#status': 'ACTIVE POLICY', '#branch-code': 'HO' });
  const total = (await (await fetch(DATA + '/policies?status=ACTIVE%20POLICY')).json()).length;
  ok(r.length === total && total >= 20, `Status ACTIVE POLICY + Branch HO returns all ${r.length} of ${total} policies`);
  r = await search(p, { '#contract-no': C, '#branch-code': 'ALL', '#party-stake-name': 'Contract Owner' });
  ok(r.join() === C, 'Party Stake Name "Contract Owner" with Branch ALL still finds the policy');
  ok((await p.$eval('#party-stake-name', e => e.value)) === 'Contract Owner' && (await p.$eval('#branch-code', e => e.value)) === 'ALL', 'the dropdowns keep their selection after Search');

  // ---- Endorsement Initiation modal ----
  await p.goto(`${B}/policy/${C}/endorse`);
  ok(await p.$eval('#field-later-effective-date-value', e => e.hidden), 'Later Effective Date field is hidden while the answer is No');
  await p.select('#later-effective-date', 'Yes');
  ok(!(await p.$eval('#field-later-effective-date-value', e => e.hidden)), 'choosing Yes reveals the Later Effective Date field');
  const owner = await p.$$eval('#requester-party option', o => o.map(x => x.textContent));
  await p.select('#requester-stake-code', 'Adviser');
  const adv = await p.$$eval('#requester-party option', o => o.map(x => x.textContent));
  ok(owner.length === 1 && adv.length === 1 && owner[0] !== adv[0] && adv[0].includes('RIKHOTSO'), `Requester Party follows the stake code: owner "${owner[0]}" vs adviser "${adv[0]}"`);
  await p.select('#requester-stake-code', 'Contract Owner');
  await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right');
  await step(p, '#btn-save');
  ok(((await text(p, '#modal-error-message')) || '').startsWith('56102'), `Yes without a date refused: ${((await text(p, '#modal-error-message')) || '').slice(0, 60)}`);
  // the modal keeps what was chosen, so only the date needs correcting
  await p.type('#later-effective-date-value', '01/08/2026');
  await step(p, '#btn-save');
  ok(((await text(p, '#modal-error-message')) || '').startsWith('56105'), `a past Later Effective Date refused: ${((await text(p, '#modal-error-message')) || '').slice(0, 70)}`);
  await p.click('#later-effective-date-value', { clickCount: 3 }); await p.type('#later-effective-date-value', '30/11/2026');
  await step(p, '#btn-save');
  ok(p.url().endsWith(`/policy/${C}`) && await p.$('#endorse-modal') === null, 'a valid future date saves the endorsement');
  await step(p, '#hdr-policy-number');
  await step(p, '#nav-endorsement-quotes');
  const eff = await text(p, '#endr-row-1 td:nth-child(5)');
  ok(eff === '30/11/2026', `Endorsement Quotes shows the later effective date: ${eff}`);

  // ---- Basic Details dropdowns ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(`${B}/policy/${C}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  await step(p, '#nav-basic-details');
  const bdLoading = await p.evaluate(() => {
    const top = () => Math.round(document.getElementById('btn-save').getBoundingClientRect().top);
    const before = top();
    document.body.classList.add('is-loading');
    const r = { before, during: top(), loaderBottom: Math.round(document.getElementById('page-loader').getBoundingClientRect().bottom),
      sections: [...document.querySelectorAll('details.section')].every(d => getComputedStyle(d).display === 'none') };
    document.body.classList.remove('is-loading');
    return r;
  });
  ok(bdLoading.sections && bdLoading.during < bdLoading.before - 300 && bdLoading.during >= bdLoading.loaderBottom, `Basic Details while saving: the sections drop away and Save moves up under the loader (${bdLoading.before} to ${bdLoading.during}, loader ends ${bdLoading.loaderBottom})`);
  const locked = ['bd-segment', 'bd-distribution-channel', 'bd-sales-code-type', 'bd-currency', 'bd-savings-need', 'bd-admin-quote', 'bd-trustee-endorsed', 'bd-rider-commission-applicable'];
  const lockedOk = await Promise.all(locked.map(id => p.$eval('#' + id, e => e.disabled)));
  ok(lockedOk.every(Boolean), 'read-only dropdowns (Segment, Distribution Channel, Currency, ...) are greyed out and disabled');
  const reasons = await p.$$eval('#bd-amend-pot-percentage-reason option', o => o.map(x => x.textContent));
  ok(reasons.length >= 4, `Amend Pot Percentage Reason has real options: ${reasons.filter(Boolean).join(', ')}`);
  await p.select('#bd-amend-pot-percentage-reason', 'Change of adviser');
  await p.select('#bd-no-dealings', 'Yes');
  await p.type('#bd-remove-reason', 'Adviser moved to another firm');
  await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0');
  await step(p, '#btn-save');
  ok((await text(p, '#bd-amend-pot-percentage-reason')) === 'Change of adviser' && (await text(p, '#bd-no-dealings')) === 'Yes' && (await text(p, '#bd-remove-reason')) === 'Adviser moved to another firm', 'the editable dropdowns and Remove Reason are saved and shown after the refresh');
  ok((await text(p, '#vat-inclusive-asset-advice-fee')) === '0.000' && (await text(p, '#vat-exclusive-asset-advice-fee')) === '0.000', 'VAT Inclusive 0 -> both fees 0.000');

  // ---- Endr Quote Submission: the SOP's five dropdowns ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(`${B}/policy/${C}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  await p.goto(`${B}/policy/${C}/quote-submission`);
  const sel = ['#admin-requirements-outstanding', '#underwriting-requirements-outstanding', '#all-admin-requirements-received', '#reinsurance-verified', '#legal-verification'];
  const enabled = await Promise.all(sel.map(id => p.$eval(id, e => !e.disabled)));
  ok(enabled.every(Boolean), 'the five SOP dropdowns can be filled in while the quote is still a draft');
  ok(await p.$eval('#all-parties-accepted', e => e.disabled), 'All Contracting Parties have accepted is read-only (it follows Acceptance)');
  ok(await p.$eval('#btn-submit', e => e.disabled), 'Submit is greyed out until the endorsement is finalised');
  const opts = async id => p.$$eval(id + ' option', o => o.map(x => x.textContent || '(blank)'));
  ok((await opts('#all-admin-requirements-received')).includes('Accepted') && (await opts('#admin-requirements-outstanding'))[0] === '(blank)' && (await opts('#legal-verification')).includes('Approved') && (await opts('#reinsurance-verified')).includes('Yes'), 'each dropdown offers the SOP value (blank / Accepted / Approved / Yes)');
  ok((await p.$$eval('#sec-acceptance-declaration select', es => es.every(e => !e.title))), 'the Acceptance and Declaration fields carry no SOP tooltips');
  // fill exactly as the SOP says, then Save
  await p.select('#admin-requirements-outstanding', ''); await p.select('#underwriting-requirements-outstanding', '');
  await p.select('#all-admin-requirements-received', 'Accepted'); await p.select('#reinsurance-verified', 'Yes');
  await p.select('#legal-verification', 'Approved'); await step(p, '#btn-save');
  ok((await text(p, '#all-admin-requirements-received')) === 'Accepted' && (await text(p, '#reinsurance-verified')) === 'Yes', 'Save in draft keeps the choices');
  // carry on to Finalise: choices persist, Accepted flag now follows the acceptance
  await step(p, '#nav-acceptance'); await step(p, '#acceptance-serial-1'); await p.select('#application-accepted', 'Yes'); await p.type('#acceptance-date', '04/08/2026'); await step(p, '#btn-save');
  await step(p, '#nav-endr-quote-summary');
  for (const id of ['#btn-create-refresh-layer', '#btn-calculate-premium', '#btn-end-sub-endorsement', '#btn-lock-ebq', '#btn-finalise-endorsement']) await step(p, id);
  await step(p, '#nav-endr-quote-submission');
  ok((await text(p, '#all-admin-requirements-received')) === 'Accepted' && (await text(p, '#reinsurance-verified')) === 'Yes' && (await text(p, '#all-parties-accepted')) === 'Yes', 'after Finalise the earlier choices are still there and All Contracting Parties = Yes');
  ok(!(await p.$eval('#btn-submit', e => e.disabled)), 'Submit is now enabled');
  await step(p, '#btn-submit');
  ok((await text(p, '#hdr-sub-status')) === 'Endorsement Submitted', 'Save then Submit completes the SOP step');
  await step(p, '#hdr-policy-number');

  // ---- A 60/40 split runs the whole summary flow without hand-calculating the fee ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const advisers = await (await fetch(DATA + '/advisers')).json();
  const A1 = advisers.find(a => a.salesCode === '699001').partyCode, A2 = advisers.find(a => a.salesCode === '694653').partyCode;
  const fillRow = async (i, advisor, primary, vals) => {
    await p.select(`#share-advisor-${i}`, advisor); await p.select(`#share-primary-${i}`, primary);
    for (let k = 0; k < vals.length; k++) { await p.$eval(`#share-${i}-${k}`, e => { e.value = ''; }); if (vals[k] !== '') await p.type(`#share-${i}-${k}`, String(vals[k])); }
  };
  await p.goto(`${B}/policy/${C}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  for (const [type, one, two] of [['contribution', [60, 60, 60, 60], [40, 40, 40, 40]], ['asset', ['', '', 60, 60, '', ''], ['', '', 40, 40, '', '']]]) {
    await p.goto(`${B}/policy/${C}/sharing/${type}`); await step(p, '#btn-share-add'); await fillRow(0, A1, 'Yes', one);
    await step(p, '#btn-share-add'); await fillRow(1, A2, 'No', two); await step(p, '#btn-share-save');
  }
  await step(p, '#btn-save');                                            // Advisor Change > Save
  await step(p, '#nav-basic-details');
  const f60 = [await text(p, '#vat-inclusive-asset-advice-fee'), await text(p, '#vat-exclusive-asset-advice-fee')];
  ok(f60[0] === '0.345' && f60[1] === '0.300', `a 60/40 split calculates the fee on its own: ${f60.join(' / ')} (0.575 x 60%)`);
  await p.goto(`${B}/policy/${C}/acceptance`); await step(p, '#acceptance-serial-1'); await p.select('#application-accepted', 'Yes'); await p.type('#acceptance-date', '04/08/2026'); await step(p, '#btn-save');
  await step(p, '#nav-endr-quote-summary'); await step(p, '#btn-create-refresh-layer'); await step(p, '#btn-calculate-premium');
  ok(!(await text(p, '#error-message')), 'Calculate Premium goes through with no hand-entered fee');
  const stateBar = async () => p.$$eval('#endorsement-action-bar button[id]', bs => bs.filter(b => !b.disabled).map(b => b.id));
  ok((await stateBar()).includes('btn-end-sub-endorsement'), 'End Sub Endorsement is enabled after Calculate Premium');
  await step(p, '#nav-policy-action-details');
  ok((await stateBar()).includes('btn-end-sub-endorsement'), 'and also enabled on Policy Action Details');
  await step(p, '#nav-endr-quote-summary');
  for (const id of ['#btn-end-sub-endorsement', '#btn-lock-ebq', '#btn-finalise-endorsement']) await step(p, id);
  ok((await text(p, '#hdr-status')) === 'FINAL ENDORSEMENT QUOTE', `the flow reaches Finalise: ${await text(p, '#hdr-status')}`);

  // a wrong fee is refused, and it is recoverable because Basic Details is still open at that point
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(`${B}/policy/${C}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  await p.goto(`${B}/policy/${C}/sharing/asset`); await step(p, '#btn-share-add'); await fillRow(0, A1, 'Yes', ['', '', 60, 60, '', '']);
  await step(p, '#btn-share-add'); await fillRow(1, A2, 'No', ['', '', 40, 40, '', '']); await step(p, '#btn-share-save'); await step(p, '#btn-save');
  await step(p, '#nav-basic-details'); await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0.287'); await step(p, '#btn-save');
  await p.goto(`${B}/policy/${C}/quote-summary`); await step(p, '#btn-create-refresh-layer'); await step(p, '#btn-calculate-premium');
  ok(((await text(p, '#error-message')) || '').includes('must be 0.345'), 'the SOP fee 0.287 is refused for a 60/40 split, and the message says 0.345');
  await step(p, '#nav-basic-details'); await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0.345'); await step(p, '#btn-save');
  await step(p, '#nav-endr-quote-summary'); await step(p, '#btn-calculate-premium');
  ok(!(await text(p, '#error-message')) && (await stateBar()).includes('btn-end-sub-endorsement'), 'after correcting the fee, Calculate Premium succeeds and End Sub Endorsement unlocks');

  // ---- the summary steps always say what comes next ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(`${B}/policy/${C}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  await p.goto(`${B}/policy/${C}/acceptance`); await step(p, '#acceptance-serial-1'); await p.select('#application-accepted', 'Yes'); await p.type('#acceptance-date', '04/08/2026'); await step(p, '#btn-save');
  await step(p, '#nav-endr-quote-summary'); await step(p, '#btn-create-refresh-layer'); await step(p, '#btn-calculate-premium');
  const tip = await p.$eval('#btn-lock-ebq', e => e.title);
  ok(tip.includes('End Sub Endorsement'), `a greyed Lock EBQ explains itself on hover: "${tip}"`);
  const post = (action) => fetch(`${DATA}/policies/${C}/endorsements/1/actions/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'nzwane' }) }).then(r => r.json());
  let r1 = await post('lock-ebq');
  ok(r1.error && r1.error.code === 30404 && r1.error.message.includes('The next step is End Sub Endorsement'), 'Lock EBQ too early names the step to take first');
  await step(p, '#btn-end-sub-endorsement');
  ok((await p.$$eval('#endorsement-action-bar button[id]', bs => bs.filter(b => !b.disabled).map(b => b.id))).includes('btn-lock-ebq'), 'Lock EBQ is enabled straight after End Sub Endorsement');
  r1 = await post('end-sub-endorsement');
  ok(r1.error && r1.error.code === 30410 && r1.error.message.includes('already been performed') && r1.error.message.includes('next step is Lock EBQ'), `a repeated End Sub Endorsement says it is done and points to Lock EBQ: ${(r1.error || {}).message}`);
  const hdrs = await p.evaluate(async () => (await fetch(location.href)).headers.get('cache-control'));
  ok(hdrs === 'no-store', 'screens are served no-store, so Back never shows an old copy of the buttons');
  await step(p, '#btn-lock-ebq');
  ok((await text(p, '#hdr-sub-status')) === 'Endorsement Quote Locked', 'Lock EBQ then locks the quote');

  // ---- Latency: a per-step table set on the login page, waited out on the server ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const table = await (await fetch(DATA + '/settings')).json();
  ok(table.steps.length === 11 && table.steps.find(x => x.key === 'createLayer').normal === 30 && table.steps.find(x => x.key === 'createLayer').stress === 90 && table.steps.find(x => x.key === 'lockEbq').normal === 20 && table.steps.find(x => x.key === 'calcPremium').stress === 75, 'the latency table has the 11 steps with the Normal and Stress figures from the recording');
  await p.goto(B + '/login');
  ok((await p.$$('#latency-table [id^=latency-row-]')).length === 12 && await p.$('#latency-normal-createLayer') !== null && await p.$('#latency-stress-lockEbq') !== null, 'the login page shows every step with an editable Normal and Stress figure');
  ok(await p.$eval('#latency-normal-createLayer', e => e.value) === '30' && await p.$eval('#latency-stress-createLayer', e => e.value) === '90', 'the defaults shown are Normal 30 s and Stress 90 s for Create or Refresh Layer');
  // small figures so the run stays quick: every step waits 1 s, the two calculations 2 s
  const small = { search: 1, endorseOpen: 1, endorseSave: 1, basicSave: 1, createLayer: 2, calcPremium: 2, endSub: 1, lockEbq: 1, finalise: 1, submit: 1, activate: 1 };
  const backTo = await applyLatency(browser, { profile: 'normal', normal: small });
  await p.goto(B + '/login');
  ok((await text(p, '#latency-normal-createLayer')) === '2', 'an edited figure is saved and shown again');
  const timed = async fn => { const t0 = Date.now(); await fn(); return Date.now() - t0; };
  const near = (ms, s) => ms >= s * 1000 - 100 && ms < s * 1000 + 1500;
  const steps = {};
  await p.goto(B + '/policy-servicing/search'); await p.type('#contract-no', C);
  steps.search = await timed(() => step(p, '#btn-search'));
  await step(p, `#result-link-${C}`);
  steps.endorseOpen = await timed(() => p.click('#btn-endorse-alter').then(() => p.waitForSelector('#endorse-modal')));
  await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right');
  steps.endorseSave = await timed(() => step(p, '#btn-save'));
  await step(p, '#nav-basic-details'); await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0');
  steps.basicSave = await timed(() => step(p, '#btn-save'));
  await p.goto(`${B}/policy/${C}/acceptance`); await step(p, '#acceptance-serial-1'); await p.select('#application-accepted', 'Yes'); await p.type('#acceptance-date', '04/08/2026');
  const accT = await timed(() => step(p, '#btn-save'));
  await step(p, '#nav-endr-quote-summary');
  const loading = await p.evaluate(() => new Promise(resolve => {
    const f = document.getElementById('btn-create-refresh-layer').form;
    // registered after the page's own submit handler, so it runs after the loading state has been applied
    document.addEventListener('submit', ev => { ev.preventDefault(); const shown = document.body.classList.contains('is-loading') && getComputedStyle(document.getElementById('page-loader')).display !== 'none'; document.body.classList.remove('is-loading'); resolve(shown); }, { once: true });
    f.requestSubmit();
  }));
  ok(loading, 'the loading state (dotted-ring loader) is shown while the screen waits');
  steps.createLayer = await timed(() => step(p, '#btn-create-refresh-layer'));
  steps.calcPremium = await timed(() => step(p, '#btn-calculate-premium'));
  steps.endSub = await timed(() => step(p, '#btn-end-sub-endorsement'));
  steps.lockEbq = await timed(() => step(p, '#btn-lock-ebq'));
  steps.finalise = await timed(() => step(p, '#btn-finalise-endorsement'));
  await step(p, '#nav-endr-quote-submission');
  await p.select('#all-admin-requirements-received', 'Accepted'); await p.select('#reinsurance-verified', 'Yes');
  await step(p, '#btn-save');
  steps.submit = await timed(() => step(p, '#btn-submit'));
  const expected = { search: 1, endorseOpen: 1, endorseSave: 1, basicSave: 1, createLayer: 2, calcPremium: 2, endSub: 1, lockEbq: 1, finalise: 1, submit: 1 };
  for (const [k, s] of Object.entries(expected)) ok(near(steps[k], s), `${k} waits its configured ${s} s (${steps[k]} ms)`);
  ok(accT < 900, `Save on Acceptance has no wait in the table (${accT} ms)`);
  ok((await text(p, '#hdr-sub-status')) === 'Endorsement Submitted' && !(await text(p, '#error-message')), 'every wait ends in success on its own: nothing to retry');
  // the Checker does not wait: search and Activate are configured at 1 s but run at once
  const v = await (await browser.createBrowserContext()).newPage(); await v.setViewport({ width: 1280, height: 800 });
  await v.goto(B + '/login'); await v.select('#login-user', 'dvisser'); await step(v, '#btn-login');
  await v.goto(`${B}/policy-servicing/search`); await v.type('#contract-no', C);
  const chkSearch = await timed(() => step(v, '#btn-search'));
  ok(chkSearch < 900, `the Checker's search does not wait its 1 s (${chkSearch} ms)`);
  await v.goto(`${B}/policy/${C}?ctx=policy`); await step(v, '#nav-endorsement-quotes'); await step(v, '#endr-serial-1'); await step(v, '#nav-endr-quote-submission');
  steps.activate = await timed(() => step(v, '#btn-activate'));
  ok(steps.activate < 900 && (await text(v, '#hdr-sub-status')) === 'Approved Endorsed Quote', `the Checker's Activate does not wait its configured 1 s (${steps.activate} ms)`);
  await v.close();
  // a failed search/step does not wait: errors come back at once
  await p.goto(`${B}/policy/114020658001?ctx=policy`);   // has an open draft endorsement
  const blocked = await timed(() => step(p, '#btn-endorse-alter'));
  ok(blocked < 900 && ((await text(p, '#error-message')) || '').startsWith('56000'), `Endorse/Alter blocked by 56000 returns at once (${blocked} ms), without the wait`);
  // the Stress profile uses its own column
  await p.goto(B + '/login');
  const backStress = await applyLatency(browser, { profile: 'stress', normal: { search: 0 }, stress: { search: 2 } });
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(B + '/policy-servicing/search'); await p.type('#contract-no', C);
  const stressT = await timed(() => step(p, '#btn-search'));
  ok(near(stressT, 2), `profile Stress uses the Stress column: search waits 2 s, not the Normal 0 s (${stressT} ms)`);
  await p.goto(B + '/login');
  ok(((await text(p, '#latency-current')) || '').includes('Stress'), 'the login page names the active profile');
  await backStress();
  await p.goto(B + '/login');
  ok(!(await p.$eval('#latency-panel', d => d.open)), 'the latency table is closed when the developer menu opens');
  await p.click('#btn-dev-menu');
  await p.waitForSelector('#demo-controls', { visible: true });
  await p.$eval('#latency-panel', d => { d.open = true; });
  await Promise.all([p.waitForNavigation(), p.click('#btn-latency-defaults')]);
  ok(await p.$eval('#latency-normal-createLayer', e => e.value) === '30' && await p.$eval('#latency-stress-calcPremium', e => e.value) === '75', 'Restore table defaults brings the recording figures back');
  await backTo();

  // ---- The personas in the user list, the case email, and the favicon ----
  await p.goto(B + '/login');
  ok(await p.$('#block-personas') === null, 'the login page is the plain login: no persona cards');
  const optionTexts = await p.$$eval('#login-user option', o => o.map(x => x.textContent));
  ok(optionTexts.some(t => /Nandi Zwane.*Maker.*SYS-ADMIN/.test(t)) && optionTexts.some(t => /Daniel Visser.*Checker.*PREM-ADM/.test(t)), `the user list names the two personas: ${optionTexts.filter(Boolean).join(' | ')}`);
  ok(await p.$('#bar-books') === null, 'the developer menu has no BaNCS books links');
  await p.select('#login-user', 'dvisser'); await Promise.all([p.waitForNavigation(), p.click('#btn-login')]);
  ok(new URL(p.url()).pathname === '/checker/home' && (await text(p, '#user-role')) === 'PREM-ADM' && (await text(p, '#welcome-user')).includes('Daniel Visser'), `the Checker logs in as Daniel Visser, PREM-ADM, and lands on /checker/home (${new URL(p.url()).pathname})`);
  await p.goto(B + '/home');
  ok(new URL(p.url()).pathname === '/checker/home', 'Home takes the Checker to /checker/home');
  await p.goto(B + '/login');
  await p.select('#login-user', 'nzwane'); await Promise.all([p.waitForNavigation(), p.click('#btn-login')]);
  ok(new URL(p.url()).pathname === '/home' && (await text(p, '#user-role')) === 'SYS-ADMIN' && (await text(p, '#welcome-user')).includes('Nandi Zwane'), 'the Maker logs in as Nandi Zwane, SYS-ADMIN, and lands on /home');
  await p.goto(B + '/login'); await p.click('#btn-dev-menu'); await p.waitForSelector('#demo-controls', { visible: true });
  ok(!(await p.$('#form-case-email')) && !(await p.$('#link-open-mailbox-dev')), 'the developer menu has no email controls');
  for (const [kind, type] of [['xlsx', 'spreadsheetml'], ['pdf', 'application/pdf']]) {
    const href = await p.$eval(`#link-dummy-data-${kind}`, a => a.href);
    const res = await fetch(href);
    ok(res.status === 200 && (res.headers.get('content-type') || '').includes(type) && (res.headers.get('content-disposition') || '').includes('synthetic') && (await res.arrayBuffer()).byteLength > 5000, `the developer menu downloads the dummy data as ${kind}`);
  }
  for (const [kind, head] of [['csv', 'Assigned,Approver,ContractNumber'], ['transition-csv', 'RELATIONSHIP TRANSITION LIST']]) {
    const csv = await (await fetch(`${B}/login/dummy-data/${kind}`)).text();
    ok(csv.startsWith(head) && csv.includes(kind === 'csv' ? '119900001001' : 'IMED_CODE_FROM'), `the ${kind} endpoint serves the first tab as CSV for Google Sheets`);
  }
  await browser.defaultBrowserContext().overridePermissions(B, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await p.evaluate(() => { const w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = t => { window.__copied = t; return w(t).catch(() => {}); }; });
  const tabOpened = new Promise(r => browser.once('targetcreated', t => r(t.url())));
  await p.click('#link-dummy-data-gsheet');
  await p.bringToFront(); await new Promise(r => setTimeout(r, 300));
  const formula = await p.evaluate(() => window.__copied);
  ok(formula === '=IMPORTDATA("https://om-bancs.onrender.com/login/dummy-data/csv", ",", "en_GB")', `Google Sheets copies the import formula: ${formula}`);
  ok(/sheets\.new|docs\.google\.com|about:blank/.test(await Promise.race([tabOpened, new Promise(r => setTimeout(() => r('none'), 3000))])), 'Google Sheets opens a new sheet in a new tab');
  ok(((await text(p, '#gsheet-status')) || '').startsWith('Formula copied'), 'the panel says where to paste it');
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const mb = await browser.newPage();
  await mb.goto(`${MAIL}/mail?user=nzwane`);
  ok(((await text(mb, '#mailbox-role')) || '') === 'MAKER' && await mb.$('#message-m1') !== null, 'the Maker\'s mailbox holds the case email after a reset');
  await Promise.all([mb.waitForNavigation(), mb.click('#message-m1')]);
  const sheetRow = (await (await fetch(DATA + '/worklist')).json()).find(w => w.contractNumber === C);
  ok((await text(mb, '#case-contract')) === C && (await text(mb, '#case-d-id')) === sheetRow.idNumber && (await text(mb, '#case-d-declared')) === sheetRow.declarationSignedDate, `the email carries the contract, ID ${sheetRow.idNumber} and declaration date ${sheetRow.declarationSignedDate} from the sheet`);
  ok(((await mb.$eval('#sheet-row-' + C, e => e.className)) || '').includes('case-row') && (await mb.$$('#sheet-si tbody tr')).length >= 26, 'the attachment preview shows the whole S&I sheet with the case row highlighted');
  const att = await fetch(MAIL + await mb.$eval('#link-attachment', a => a.getAttribute('href')));
  ok(att.status === 200 && (att.headers.get('content-type') || '').includes('spreadsheetml') && (await att.arrayBuffer()).byteLength > 5000, 'the attachment downloads as the Excel workbook');
  const mailHtml = await mb.content();
  ok(mailHtml.includes('cdn.whatfix.com/prod/e7817f15-91df-440e-906c-959e507b7b6d/initiator/initiator.nocache.js') && !/tata/i.test(mailHtml) && mailHtml.includes('favicon.svg?v=3'), 'the mail pages carry the Whatfix script and the bank favicon, with no Tata branding');
  await mb.goto(B + '/login');
  const bancsHtml = await mb.content();
  ok(bancsHtml.includes('favicon.svg?v=3') && bancsHtml.includes('favicon.ico?v=3') && !/tata/i.test(bancsHtml), 'the BaNCS pages use the versioned bank favicon, so Chrome drops the old icon');
  const fav = await (await fetch(B + '/static/favicon.svg')).text();
  ok(fav.includes('<rect') && !/tata/i.test(fav), 'the favicon is the bank mark');
  await mb.close();
  await p.goto(B + '/login');
  await p.click('#btn-dev-menu'); await p.waitForSelector('#demo-controls', { visible: true });
  ok((await p.$$eval('[id^="browser-hang-"]', es => es.map(e => e.value))).every(v => v === 'No'), 'the developer menu defaults to Browser hang = No for every step');
  await fetch(DATA + '/admin/reset', { method: 'POST' });

  // ---- Loading state and browser hang. Chrome holds back scripts sent to a page while a form navigation is
  // pending, so these are measured from inside the page: a heartbeat records the longest gap between its own
  // ticks (how long the main thread was blocked), and a watcher records what the loading state looks like 250 ms
  // after it starts. The next page reads both back from sessionStorage. ----
  const probe = () => {
    const store = (k, v) => sessionStorage.setItem(k, String(v));
    let last = Date.now();
    const gap = () => { const g = Date.now() - last, prev = Number(sessionStorage.getItem('__maxGap') || 0); if (g > prev) store('__maxGap', g); };
    setInterval(() => { gap(); last = Date.now(); }, 50);
    addEventListener('pagehide', gap);
    const shown = sel => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0; };
    new MutationObserver(() => {
      if (!document.body || !document.body.classList.contains('is-loading') || window.__snapped) return;
      window.__snapped = true;
      setTimeout(() => {
        const bar = [...document.querySelectorAll('#endorsement-action-bar .btn')].filter(b => b.textContent.trim());
        const l = document.getElementById('page-loader').getBoundingClientRect(), h = document.getElementById('policy-header').getBoundingClientRect();
        store('__loadSnap', JSON.stringify({
          hidden: ['#sec-ebq-summary', '#sec-commission-summary', '#sec-eac-details'].map(x => !shown(x)),
          kept: ['#policy-header', '#endorsement-action-bar', '#left-nav', '#breadcrumb', '#page-loader'].map(shown),
          dots: document.querySelectorAll('#page-loader .ring i').length, below: l.top >= h.bottom - 1, farLeft: l.left < 260,
          cursor: getComputedStyle(document.body).cursor, buttons: bar.length,
          place: [...document.querySelectorAll('.btn')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.id, Math.round(r.left), Math.round(r.top), b.disabled]; }),
          barTop: Math.round(document.getElementById('endorsement-action-bar').getBoundingClientRect().top), loaderBottom: Math.round(l.bottom),
          noEmpty: [...document.querySelectorAll('#endorsement-action-bar button')].every(b => getComputedStyle(b).display === 'none' || b.textContent.trim())
        }));
      }, 250);
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });   // the document node exists before <html> does
  };
  const readProbe = async () => p.evaluate(() => ({ gap: Number(sessionStorage.getItem('__maxGap') || 0), snap: JSON.parse(sessionStorage.getItem('__loadSnap') || 'null') }));
  const clearProbe = async () => p.evaluate(() => { sessionStorage.removeItem('__maxGap'); sessionStorage.removeItem('__loadSnap'); });
  const prepareSummary = async () => {
    await fetch(DATA + '/admin/reset', { method: 'POST' });
    await p.goto(`${B}/policy/${C}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
    await p.goto(`${B}/policy/${C}/acceptance`); await step(p, '#acceptance-serial-1'); await p.select('#application-accepted', 'Yes'); await p.type('#acceptance-date', '04/08/2026'); await step(p, '#btn-save');
    await step(p, '#nav-endr-quote-summary');
  };
  await p.evaluateOnNewDocument(probe);

  // loading state, Browser hang off
  const backLoad = await applyLatency(browser, { profile: 'normal', hang: false, normal: { createLayer: 3, calcPremium: 3, endSub: 3, lockEbq: 3, finalise: 3, search: 2 } });
  await prepareSummary();
  const shown = sel => p.$eval(sel, e => getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0).catch(() => false);
  ok(await shown('#sec-ebq-summary') && await shown('#sec-commission-summary'), 'before the click the summary sections are showing');
  const placeBefore = await p.$$eval('.btn', bs => bs.filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.id, Math.round(r.left), Math.round(r.top), b.disabled]; }));
  await clearProbe();
  const t1 = Date.now();
  await Promise.all([p.waitForNavigation(), p.click('#btn-create-refresh-layer')]);
  ok(Date.now() - t1 >= 2900, `Create or Refresh Layer waits its 3 s (${Date.now() - t1} ms)`);
  let pr = await readProbe(); const sn = pr.snap;
  ok(!!sn, 'the page entered its loading state when the button was clicked');
  if (sn) {
    ok(sn.hidden.every(Boolean), 'the summary sections go blank');
    ok(sn.kept.every(Boolean), 'the header band, the button row, the left menu, the breadcrumb and the loader stay');
    ok(sn.dots === 12 && sn.below && sn.farLeft, 'a 12-dot ring loader sits at the far left, directly under the header band');
    ok(sn.cursor === 'wait', 'the cursor is the wait cursor');
    ok(sn.buttons >= 6 && sn.noEmpty, `all ${sn.buttons} bar buttons keep their labels, with no empty button after Follow up report`);
    const before = Object.fromEntries(placeBefore.map(x => [x[0], x])), during = sn.place.filter(x => before[x[0]]);
    ok(during.length === placeBefore.length && during.every(x => x[1] === before[x[0]][1] && x[3] === before[x[0]][3]), `while loading, every button keeps its order, column and enabled or disabled state (${placeBefore.length} buttons)`);
    ok(during.filter(x => /^btn-(create|calculate|end-sub|lock|finalise)/.test(x[0])).every(x => x[2] < before[x[0]][2] - 100), 'the summary sections drop away, so the action bar moves up');
    ok(sn.barTop >= sn.loaderBottom, `the action bar sits below the loader, not under it (bar ${sn.barTop}, loader ${sn.loaderBottom})`);
  }
  ok(pr.gap < 900, `with Browser hang off the page keeps running while it loads (longest gap between ticks ${pr.gap} ms)`);
  ok(!(await p.$eval('body', b => b.classList.contains('is-loading'))) && await shown('#sec-ebq-summary') && (await text(p, '#hdr-sub-status')) === 'Sub-Endorsement Started', 'when the step finishes the full page is back');

  // Browser hang on: the page blocks its own main thread for the whole wait
  await backLoad();
  const backHang = await applyLatency(browser, { profile: 'normal', hang: { createLayer: true, calcPremium: true, endSub: true, lockEbq: true, finalise: true }, hangSeconds: { createLayer: 3, calcPremium: 3, endSub: 3, lockEbq: 3, finalise: 3 }, normal: { createLayer: 3, calcPremium: 3, endSub: 3, lockEbq: 3, finalise: 3, search: 2 } });
  await p.goto(`${B}/policy/${C}/quote-summary`);
  ok(await p.$eval('#btn-calculate-premium', b => b.form.getAttribute('data-hang-ms')) === '3000', 'with Browser hang on, the step button carries its freeze time (3000 ms)');
  await clearProbe();
  const t2 = Date.now();
  await Promise.all([p.waitForNavigation(), p.click('#btn-calculate-premium')]);
  pr = await readProbe();
  ok(pr.gap >= 2400, `with Browser hang on the page's main thread was blocked for ${pr.gap} ms, so Chrome shows its own Page Unresponsive dialog`);
  ok(Date.now() - t2 >= 2900 && !(await text(p, '#error-message')) && (await text(p, '#hdr-sub-status')) === 'Sub-Endorsement Started', 'after the freeze the step still completes: nothing to retry');
  ok(pr.snap && pr.snap.hidden.every(Boolean), 'and the loading state was showing while it was stuck');
  // the other quote-build steps freeze too; the rest of the app does not
  await clearProbe();
  await Promise.all([p.waitForNavigation(), p.click('#btn-end-sub-endorsement')]);
  ok((await readProbe()).gap >= 2400, 'End Sub Endorsement freezes the page as well');
  await p.goto(B + '/policy-servicing/search'); await p.type('#contract-no', C);
  await clearProbe();
  await Promise.all([p.waitForNavigation(), p.click('#btn-search')]);
  pr = await readProbe();
  ok(pr.gap < 900 && await p.$('#search-results') !== null, `search is not frozen even with Browser hang on (longest gap ${pr.gap} ms)`);
  await backHang();
  // each step has its own switch and its own hang time, which replaces the profile's wait (even Off): hang on search alone freezes search, and nothing else
  const backSearch = await applyLatency(browser, { profile: 'off', hang: { search: true }, hangSeconds: { search: 2 } });
  await p.goto(B + '/policy-servicing/search'); await p.type('#contract-no', C);
  ok(await p.$eval('#form-search', f => f.getAttribute('data-hang-ms')) === '2000' && await p.$('#btn-calculate-premium') === null, 'hang on search alone: the search form carries its freeze time (2000 ms)');
  await clearProbe();
  await Promise.all([p.waitForNavigation(), p.click('#btn-search')]);
  ok((await readProbe()).gap >= 1500, 'and the page freezes on search');
  await p.goto(`${B}/policy/${C}/quote-summary`);
  ok(await p.$eval('#btn-end-sub-endorsement', b => b.form.getAttribute('data-hang-ms')) === null, 'while End Sub Endorsement, with its own switch off, does not freeze');
  await backSearch();
  await p.goto(B + '/login'); await p.click('#btn-dev-menu'); await p.waitForSelector('#demo-controls', { visible: true });
  ok((await p.$$eval('[id^="browser-hang-"]', es => es.map(e => e.value))).every(v => v === 'No'), 'Browser hang is back to No for every step after the run');
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(B + '/login'); await p.select('#login-user', 'nzwane'); await Promise.all([p.waitForNavigation(), p.click('#btn-login')]);

  // ---- Endr Quote Summary: real calculations ----
  const cell = id => text(p, '#' + id);
  const openQuote = async (contract, fee) => {
    await fetch(DATA + '/admin/reset', { method: 'POST' });
    await p.goto(`${B}/policy/${contract}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
    if (fee !== undefined) { await p.goto(`${B}/policy/${contract}/basic-details`); await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', String(fee)); await step(p, '#btn-save'); }
    await p.goto(`${B}/policy/${contract}/quote-summary`);
  };
  await openQuote(C, 0);
  ok(!(await cell('ebq-refund')) && !(await cell('ebq-clawback')) && !(await cell('eac-eac-1')) && !(await cell('cs-ongoing-pct')), 'before Calculate Premium the calculated figures are blank');
  ok(!(await p.$eval('#sec-calculation-basis', d => d.open)), 'the Premium Calculation Basis section is collapsed by default');
  await step(p, '#btn-create-refresh-layer');
  ok(!(await cell('ebq-refund')), 'Create or Refresh Layer alone does not produce the figures');
  await step(p, '#btn-calculate-premium');
  ok((await cell('ebq-total-premium')) === '600.00' && (await cell('ebq-refund')) === '1.74' && (await cell('ebq-clawback')) === '1.51' && (await cell('ebq-collection')) === '0.00' && (await cell('ebq-commission')) === '0.00', 'policy A, fee 0.575 to 0: premium 600.00, refund 1.74, clawback 1.51, nothing to collect (R4,323.48 x 0.575% = R24.86 a year, R2.07 a month, 26 of 31 days left)');
  ok((await cell('cs-ongoing-pct')) === '0.000' && (await cell('cs-immediately')) === '-1.51' && (await cell('cs-immediate-pct')) === '0.00', 'commission summary: ongoing 0.000 % after the switch-off, -1.51 payable immediately (the clawback)');
  const eacNow = async () => p.evaluate(() => { const g = (r, k) => Number(document.getElementById(`eac-${r}-${k}`).textContent); return [1, 2, 3, 4].map(k => ({ inv: g('investment', k), adv: g('advice', k), adm: g('admin', k), oth: g('other', k), eac: g('eac', k) })); });
  let eacs = await eacNow();
  ok(eacs.every(m => Math.abs(m.inv + m.adv + m.adm + m.oth - m.eac) < 0.0051), 'at every milestone Investment + Advice + Admin + Other add up to the EAC');
  ok(eacs[0].eac === 4.57 && eacs[1].eac === 1.89 && eacs[2].eac === 1.53 && eacs[3].eac === 1.35 && eacs.every(m => m.adv === 0), `EAC ${eacs.map(m => m.eac).join(' / ')} at years ${await p.$$eval('#eac-details th[title]', h => h.map(x => x.title.replace('Year ', '')).join(', '))}; Advice is 0.00 once the fee is switched off`);
  ok(eacs[0].eac > eacs[1].eac && eacs[1].eac > eacs[2].eac && eacs[2].eac > eacs[3].eac, 'EAC falls as the milestone gets longer, as the initial charge is spread out');
  await p.$eval('#sec-calculation-basis', d => { d.open = true; });
  ok((await cell('cb-period')).includes('30/07/2026') && (await cell('cb-period')).includes('31 days') && (await cell('cb-remaining')) === '26' && (await cell('cb-annual')).startsWith('24.86') && (await cell('cb-monthly')).startsWith('2.07'), 'the calculation basis shows the working: period 30/07 to 30/08 (31 days), 26 days left, 24.86 a year, 2.07 a month');
  // a fee that is left unchanged: nothing to refund, and the Advice EAC is the fee itself
  await openQuote(C);
  await step(p, '#btn-create-refresh-layer'); await step(p, '#btn-calculate-premium');
  eacs = await eacNow();
  ok((await cell('ebq-refund')) === '0.00' && (await cell('ebq-collection')) === '0.00' && eacs.every(m => m.adv > 0.5 && m.adv < 0.65), `fee left at 0.575: no refund, no collection, Advice EAC ${eacs.map(m => m.adv).join(' / ')}`);
  // a fee that rises: collected from the client, and commission is payable on the rest of the period
  await openQuote('113084721001', 1.5);
  await step(p, '#btn-create-refresh-layer'); await step(p, '#btn-calculate-premium');
  ok((await cell('ebq-refund')) === '0.00' && (await cell('ebq-collection')) === '37.02' && (await cell('ebq-clawback')) === '0.00' && (await cell('ebq-commission')) === '69.48', 'fee 0.805 raised to 1.500 on R132,096.00: R37.02 collected, no clawback, R69.48 commission for the rest of the period');
  // a fee change after Calculate Premium makes the figures out of date until they are calculated again
  await openQuote(C, 0);
  await step(p, '#btn-create-refresh-layer'); await step(p, '#btn-calculate-premium');
  await p.goto(`${B}/policy/${C}/basic-details`); await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0.2'); await step(p, '#btn-save');
  await p.goto(`${B}/policy/${C}/quote-summary`);
  await p.$eval('#sec-calculation-basis', d => { d.open = true; });
  const enabledNow = await p.$$eval('#endorsement-action-bar button[id]', bs => bs.filter(b => !b.disabled).map(b => b.id));
  ok(await p.$('#calc-stale-note') !== null && enabledNow.includes('btn-calculate-premium') && !enabledNow.includes('btn-end-sub-endorsement'), 'after the fee is changed the page says the figures are out of date, Calculate Premium opens again and End Sub Endorsement waits');
  const endSub = await fetch(`${DATA}/policies/${C}/endorsements/1/actions/end-sub-endorsement`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'nzwane' }) }).then(r => r.json());
  ok(endSub.error && endSub.error.code === 30411, `the server refuses End Sub Endorsement on out-of-date figures: ${endSub.error && endSub.error.code}`);
  await step(p, '#btn-calculate-premium');
  ok(await p.$('#calc-stale-note') === null && (await cell('ebq-refund')) === '1.13' && (await p.$$eval('#endorsement-action-bar button[id]', bs => bs.filter(b => !b.disabled).map(b => b.id))).includes('btn-end-sub-endorsement'), 'calculating again clears it: refund 1.13 for a fee of 0.200, and End Sub Endorsement is available');
  await step(p, '#btn-end-sub-endorsement');
  ok((await text(p, '#hdr-sub-status')) === 'Sub-Endorsement End', 'and the flow carries on');
  // the fee can still be corrected after End Sub Endorsement: it reopens the quote at Calculate Premium
  await p.goto(`${B}/policy/${C}/basic-details`);
  ok(await p.$eval('#vat-inclusive-asset-advice-fee', i => !i.readOnly), 'VAT Inclusive Asset Advice Fee is still editable after End Sub Endorsement');
  await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0.23');
  await step(p, '#btn-save');
  ok((await text(p, '#vat-inclusive-asset-advice-fee')) === '0.230' && (await text(p, '#hdr-sub-status')) === 'Sub-Endorsement Started', 'saved at 0.230 and the quote is reopened');
  await p.goto(`${B}/policy/${C}/quote-summary`);
  ok((await p.$$eval('#endorsement-action-bar button[id]', bs => bs.filter(b => !b.disabled).map(b => b.id))).includes('btn-calculate-premium'), 'Calculate Premium is available again after the correction');
  await fetch(DATA + '/admin/reset', { method: 'POST' });

  // ---- The developer menu: hidden behind a small bug button ----
  await p.goto(B + '/login');
  const vis = sel => p.$eval(sel, e => !!(e.offsetParent || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden').catch(() => false);
  ok(await vis('#btn-dev-menu'), 'the login page shows a bug button for the developer menu');
  ok(!(await vis('#demo-controls')) && !(await vis('#btn-reset-data')) && !(await vis('#latency-table')), 'Reset data and the latency table are hidden until the button is used');
  const box = await p.$eval('#btn-dev-menu', e => { const r = e.getBoundingClientRect(); return { right: innerWidth - r.right, top: r.top, w: r.width }; });
  ok(box.right < 44 && box.top < 60 && box.w <= 24, `the button is small and sits at the top right (${Math.round(box.w)} px wide, ${Math.round(box.right)} px from the right edge)`);
  ok(await p.$eval('#btn-dev-menu', e => e.getAttribute('aria-expanded')) === 'false', 'the button reports the menu as closed');
  await p.click('#btn-dev-menu');
  ok(await vis('#demo-controls') && await vis('#btn-reset-data') && await p.$eval('#btn-dev-menu', e => e.getAttribute('aria-expanded')) === 'true', 'clicking it opens the menu with Reset data and the latency controls');
  await p.keyboard.press('Escape');
  ok(!(await vis('#demo-controls')), 'Escape closes it');
  await p.click('#btn-dev-menu'); await p.mouse.click(300, 600);
  ok(!(await vis('#demo-controls')), 'a click outside closes it');
  await p.click('#btn-dev-menu'); await p.click('#btn-dev-menu');
  ok(!(await vis('#demo-controls')), 'clicking the button again closes it');
  ok(await p.$('#form-login') !== null && await vis('#btn-login'), 'the login form is unaffected by the menu');
  const both = await p.evaluate(() => { const b = document.getElementById('btn-dev-menu').getBoundingClientRect(), l = document.getElementById('btn-logout'); if (!l) return null; const r = l.getBoundingClientRect(); return { gap: r.left - b.right, overlap: !(b.right <= r.left || b.left >= r.right) }; });
  ok(both === null || (!both.overlap && both.gap < 30), 'if the logout icon is also on the page, the bug button sits beside it and does not cover it');
  await p.select('#login-user', 'nzwane'); await Promise.all([p.waitForNavigation(), p.click('#btn-login')]);
  for (const path of ['/home', '/policy-servicing/search', `/policy/${C}?ctx=policy`]) {
    await p.goto(B + path);
    ok(await p.$('#btn-dev-menu') === null && await p.$('#demo-controls') === null, `no developer menu on ${path.split('?')[0]}: it is the login page only`);
  }
  await p.goto(`${B}/policy/${C}?ctx=policy`);
  ok(await p.$('#btn-logout') !== null, 'logged-in pages keep the logout icon at the top right');

  // ---- Reset data, from the demo control on the login page ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await fetch(`${DATA}/policies/${C}/endorsements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'nzwane', types: ['Change Advisor Details'] }) });
  const latencyBefore = JSON.stringify(await (await fetch(DATA + '/settings')).json());
  const endorsementCount = async () => (await (await fetch(`${DATA}/policies/${C}`)).json()).endorsements.length;
  ok(await endorsementCount() === 1, 'the demo saves what you do: policy A now has the endorsement just created');
  await p.goto(B + '/login');
  await p.click('#btn-dev-menu');
  await p.waitForSelector('#demo-controls', { visible: true });
  ok(await p.$eval('#btn-reset-data', e => e.offsetParent !== null) && !(await p.$eval('#latency-panel', d => d.open)), 'opening the developer menu shows Reset data, with the latency table still closed');
  p.once('dialog', d => d.dismiss());
  await p.click('#btn-reset-data');
  await new Promise(r => setTimeout(r, 400));
  ok(await endorsementCount() === 1, 'cancelling the confirmation resets nothing');
  p.once('dialog', d => d.accept());
  await Promise.all([p.waitForNavigation(), p.click('#btn-reset-data')]);
  ok(await endorsementCount() === 0, 'confirming resets the data: policy A is back to no endorsements');
  ok(((await text(p, '#info-message')) || '').includes('reset'), `the login page says so: "${await text(p, '#info-message')}"`);
  ok(JSON.stringify(await (await fetch(DATA + '/settings')).json()) === latencyBefore, 'the latency table is kept by a reset');

  // ---- 56000 is explained, and there is a way forward ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(`${B}/policy/114020658001?ctx=policy`);
  await step(p, '#btn-endorse-alter');
  ok(((await text(p, '#error-message')) || '').startsWith('56000*****: This transaction cannot be processed as financial or Special Non-Financial transactions is already in progress.'), 'the 56000 message is unchanged, as Seek reads it');
  ok(p.url().endsWith('/policy/114020658001/error/already-exist'), `a 56000 lands on its own URL: ${p.url().replace(B, '')}`);
  ok(await p.$eval('body', b => b.dataset.screen) === 'error-already-exist' && await p.$('#screen-error-already-exist') !== null, 'the page is marked data-screen="error-already-exist"');
  await p.reload();
  ok(p.url().endsWith('/error/already-exist') && ((await text(p, '#error-message')) || '').startsWith('56000'), 'refreshing the URL shows the same 56000 page');
  const hint = (await text(p, '#error-hint')) || '';
  ok(hint.includes('1140206580010001') && hint.includes('DRAFT ENDORSEMENT QUOTE') && hint.includes('Only one endorsement can be in progress'), `the hint names the blocking quote and the rule: "${hint.slice(0, 90)}..."`);
  await step(p, '#link-error-hint');
  ok(p.url().endsWith('/policy/114020658001/endorsement-quotes'), 'the hint links to Endorsement Quotes');
  await step(p, '#endr-serial-1');
  await step(p, '#btn-reject-endorsed-quote');
  await p.goto(`${B}/policy/114020658001?ctx=policy`);
  await step(p, '#btn-endorse-alter');
  ok(await p.$('#endorse-modal') !== null && !(await text(p, '#error-message')), 'after the open quote is rejected, Endorse/Alter opens normally');
  await p.goto(`${B}/policy/${C}/error/already-exist`);
  ok(p.url().endsWith(`/policy/${C}`), 'the error URL on a policy that is not blocked goes back to the policy');
  await p.goto(`${B}/policy/113901377001?ctx=policy`);
  await step(p, '#btn-endorse-alter');
  ok(((await text(p, '#error-hint')) || '').includes('01/11/2026'), 'a future-dated approved quote is explained with its effective date');

  // ---- the left menu, as in the SOP screenshots ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const navItems = async () => p.$$eval('#left-nav li', lis => lis.map(l => ({ slug: l.dataset.nav, cls: l.className, label: l.textContent.trim() })));
  for (const [label, path] of [['login', '/login'], ['search', '/policy-servicing/search']]) {
    await p.goto(B + path);
    ok(await p.$('#left-nav') === null, `no left menu on ${label}, as in the SOP`);
  }
  await p.goto(`${B}/policy/${C}?ctx=policy`);
  let nav = await navItems(); let slugs = nav.map(n => n.slug);
  ok(slugs.includes('endorsement-quotes') && slugs.includes('layer-info') && !slugs.includes('endr-quote-summary') && !slugs.includes('endr-quote-submission') && !slugs.includes('advisor-change'), 'policy view: Endorsement Quotes and Layer Info, but no Endr Quote Summary/Submission or Advisor Change');
  ok(nav.every(n => !n.cls.includes('scoped')), 'policy view: nothing is greyed');
  await p.goto(`${B}/policy/${C}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  nav = await navItems(); slugs = nav.map(n => n.slug);
  ok(slugs.indexOf('advisor-change') > slugs.indexOf('adviser-info') && slugs[slugs.indexOf('advisor-change') + 1] === 'layer-info', 'open endorsement: Advisor Change follows Adviser Info, then Layer Info');
  ok(['endr-quote-summary', 'endr-quote-submission', 'acceptance'].every(x => slugs.includes(x)), 'open endorsement: Endr Quote Summary, Endr Quote Submission and Acceptance are there');
  const grey = nav.filter(n => n.cls.includes('scoped')).map(n => n.label).sort().join(', ');
  ok(grey === 'Adviser Info, Advisor Change, Basic Details', `Change Advisor Details greys exactly Basic Details, Adviser Info and Advisor Change (${grey})`);
  const screens = [['/basic-details', 'basic-details'], ['/acceptance', 'acceptance'], ['/acceptance/1', 'acceptance'], ['/quote-summary', 'endr-quote-summary'], ['/quote-submission', 'endr-quote-submission'], ['/advisor-change', 'advisor-change'], ['/sharing/contribution', 'advisor-change'], ['/section/contracting-party', 'contracting-party'], ['/section/layer-info', 'layer-info']];
  for (const [path, active] of screens) {
    await p.goto(`${B}/policy/${C}${path}`);
    const now = await navItems();
    ok(now.length > 15 && now.filter(n => n.cls.includes('active')).map(n => n.slug).join() === active, `the menu is on ${path} with ${active} highlighted`);
  }
  await p.setViewport({ width: 1280, height: 520 });
  await p.goto(`${B}/policy/${C}/advisor-change`);
  const inView = await p.evaluate(() => { const m = document.getElementById('left-nav').getBoundingClientRect(), a = document.querySelector('#left-nav li.active').getBoundingClientRect(); return a.top >= m.top - 1 && a.bottom <= m.bottom + 1; });
  ok(inView, 'on a short window the menu scrolls so the highlighted item is in view');
  await p.setViewport({ width: 1280, height: 800 });
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(`${B}/policy/110671307001/endorse`); await p.select('#endorsement-types-available', 'Change Payment Method'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  nav = await navItems();
  ok(!nav.map(n => n.slug).includes('advisor-change') && nav.filter(n => n.cls.includes('scoped')).map(n => n.label).join() === 'Payment Cycle', 'another endorsement type: no Advisor Change, and only Payment Cycle is greyed');

  // ---- VAT Inclusive Asset Advice Fee: editable once an endorsement is open ----
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  await p.goto(`${B}/policy/${C}/basic-details`);
  ok(await p.$eval('#vat-inclusive-asset-advice-fee', e => e.readOnly), 'before an endorsement the fee is read-only, as in BaNCS');
  await p.goto(`${B}/policy/${C}/endorse`); await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await step(p, '#btn-save');
  await step(p, '#nav-basic-details');
  ok(!(await p.$eval('#vat-inclusive-asset-advice-fee', e => e.readOnly)), 'once the endorsement is open the fee is editable');
  for (const [typed, incl, excl] of [['0', '0.000', '0.000'], ['0.00', '0.000', '0.000'], ['0%', '0.000', '0.000'], ['0.287', '0.287', '0.250'], ['1.15', '1.150', '1.000']]) {
    await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', typed);
    await step(p, '#btn-save');
    ok((await text(p, '#vat-inclusive-asset-advice-fee')) === incl && (await text(p, '#vat-exclusive-asset-advice-fee')) === excl, `typing ${typed} and saving gives ${incl} / ${excl}`);
  }
  await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0'); await step(p, '#btn-save');
  await p.goto(`${B}/policy/${C}/acceptance`); await step(p, '#acceptance-serial-1'); await p.select('#application-accepted', 'Yes'); await p.type('#acceptance-date', '04/08/2026'); await step(p, '#btn-save');
  await step(p, '#nav-endr-quote-summary'); await step(p, '#btn-create-refresh-layer'); await step(p, '#btn-calculate-premium');
  await step(p, '#nav-basic-details');
  ok(!(await p.$eval('#vat-inclusive-asset-advice-fee', e => e.readOnly)), 'the fee stays editable after Calculate Premium');
  await step(p, '#nav-endr-quote-summary'); await step(p, '#btn-end-sub-endorsement');
  await step(p, '#nav-basic-details');
  ok(!(await p.$eval('#vat-inclusive-asset-advice-fee', e => e.readOnly)), 'and after End Sub Endorsement, so a mistake can be corrected');
  await step(p, '#nav-endr-quote-summary'); await step(p, '#btn-lock-ebq');
  await step(p, '#nav-basic-details');
  ok(await p.$eval('#vat-inclusive-asset-advice-fee', e => e.readOnly), 'it locks once the EBQ is locked');

  ok(!(await p.$('#form-clear-endorsements')) && !(await p.$('#admin-reset')), 'no duplicate reset controls: no Clear endorsement quotes, no hidden reset corner');

  // The split-fee rule (Calculate Premium refused until the fee follows the split) is in checklist-split.js.
  await restoreLatency();
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
