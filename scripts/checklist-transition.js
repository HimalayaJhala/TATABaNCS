// The Relationship Transition List (PUF and CUF) and the closed book, end to end in a real browser, against a
// running demo (npm run demo). Every edge case from the 4 August 2026 recording (38:00-55:00):
//   open book: lapsed (56020), adviser mismatch, a closed-book number not found, and a full Change Primary IMED
//   move (Maker submits, Checker activates);
//   closed book: 401 without login, the open-book password refused, wildcard search over benefits, 56000 (diarise),
//   lapsed, the Add dialog's checks, and a full move the same user submits and activates.
// Usage: npm run test:transition. Turns latency off and puts it back, and resets the data at the end.
const puppeteer = require('puppeteer-core');
const { applyLatency } = require('./lib/latency');

const OPEN = 'http://localhost:4002', CLOSED = 'http://localhost:4003', DATA = 'http://localhost:4000';
const FROM = '610901', TO = '620455', TO_PARTY = 'BNCSMD-100120455';
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const api = (m, u, b) => fetch(DATA + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const sel = id => `[id="${id}"]`;   // ids may hold a closed-book contract number with slashes
const text = (p, s) => p.$eval(s, e => (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) ? e.value : e.textContent).trim()).catch(() => null);
const step = (p, s) => Promise.all([p.waitForNavigation(), p.click(s)]);

async function login(p, base, user, password = 'x') {
  await p.goto(base + '/login');
  await p.select('#login-user', user);
  await p.type('#login-password', password);
  await step(p, '#btn-login');
}
async function search(p, base, contract) {
  await p.goto(base + '/policy-servicing/search');
  await p.type('#contract-no', contract);
  await step(p, '#btn-search');
  return p.$$eval('#search-results tbody tr[id^="result-row-"]', rs => rs.map(r => r.id.replace('result-row-', '')));
}
async function openPolicy(p, base, contract) {
  await search(p, base, contract);
  await step(p, sel(`result-link-${contract}`));
}
// Endorse/Alter > Change Primary IMED > Save. Returns the page's error text, if any.
async function endorseImed(p) {
  await step(p, '#btn-endorse-alter');
  if (!(await p.$('#endorse-modal'))) return text(p, '#error-message');
  await p.select('#endorsement-types-available', 'Change Primary IMED');
  await p.click('#btn-move-right');
  await step(p, '#btn-save');
  return text(p, '#error-message');
}
// Requestor Advisor Info > Add > fill the dialog > Save. `look` uses the party-code lookup from the sales code.
async function addAdviser(p, base, contract, { salesCode = TO, look = true, partyCode, type = '0', channel = 'Personal Finance Advice SA', primary = 'Yes', replaces = 1 } = {}) {
  await p.goto(`${base}/policy/${contract}/requestor-advisor-info`);
  await step(p, '#btn-add');
  await p.type('#sales-code', salesCode);
  if (look) await step(p, '#btn-party-lookup');
  if (partyCode !== undefined) { await p.$eval('#advisor-party-code', e => { e.value = ''; }); await p.type('#advisor-party-code', partyCode); }
  await p.select('#sales-code-type', type);
  await p.select('#distribution-channel', channel);
  await p.select('#primary-flag', primary);
  if (replaces) { const v = await p.$$eval('#advisor-to-be-replaced option', os => os.map(o => o.value)); await p.select('#advisor-to-be-replaced', v[replaces]); }
  await step(p, '#btn-adviser-save');
  return text(p, '#modal-error-message');
}
// Acceptance, Endr Quote Summary steps, Endr Quote Submission > Save > Submit.
async function finishQuote(p, base, contract) {
  await p.goto(`${base}/policy/${contract}/acceptance`);
  await step(p, '#acceptance-serial-1');
  await p.select('#application-accepted', 'Yes');
  await p.type('#acceptance-date', '04/08/2026');
  await step(p, '#btn-save');
  await p.goto(`${base}/policy/${contract}/quote-summary`);
  for (const b of ['#btn-create-refresh-layer', '#btn-calculate-premium', '#btn-end-sub-endorsement', '#btn-lock-ebq', '#btn-finalise-endorsement']) await step(p, b);
  const finalised = await text(p, '#hdr-status');
  await p.goto(`${base}/policy/${contract}/quote-submission`);
  await p.select('#all-admin-requirements-received', 'Accepted');
  await p.select('#reinsurance-verified', 'Yes');
  if (!(await text(p, '#legal-verification'))) await p.select('#legal-verification', 'Approved');
  await step(p, '#btn-save');
  await step(p, '#btn-submit');
  return { finalised, sub: await text(p, '#hdr-sub-status'), error: await text(p, '#error-message') };
}
const salesCodes = async (p, base, contract) => {
  await p.goto(`${base}/policy/${contract}/requestor-advisor-info`);
  return p.$$eval('#requestor-advisors tbody tr', rs => rs.map(r => r.getAttribute('data-sales-code')));
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--host-resolver-rules=MAP *.whatfix.com ~NOTFOUND'] });
  const back = await applyLatency(browser, { profile: 'off', hang: false });
  await api('POST', '/admin/reset');
  const list = await api('GET', '/transition-list');
  ok(list.rows.length === 8 && list.rows.every(r => r.fromCode === FROM && r.toCode === TO && r.toPartyCode === TO_PARTY), 'the transition list moves 8 policies from 610901 to 620455 and carries the new party code');

  // ---------------- open book ----------------
  console.log('\nOpen book (http://localhost:4002)');
  const m = await (await browser.createBrowserContext()).newPage(); await m.setViewport({ width: 1300, height: 800 });
  await login(m, OPEN, 'nzwane');
  let rows = await search(m, OPEN, '102790002001');
  ok(rows.length === 1 && (await text(m, sel('result-status-102790002001'))) === 'LAPSED', 'search shows 102790002001 as LAPSED');
  await step(m, sel('result-link-102790002001'));
  let err = await endorseImed(m);
  ok(err && err.startsWith('56020*****') && err.includes('LAPSED'), `a lapsed policy cannot be endorsed: ${err}`);

  await openPolicy(m, OPEN, '102790003001');
  ok((await salesCodes(m, OPEN, '102790003001')).join() === '633310', 'Requestor Advisor Info on 102790003001 shows 633310, not the list\'s IMED_CODE_FROM 610901 (mismatch: stop)');
  ok(await m.$eval('#btn-add', b => b.disabled), 'outside a Change Primary IMED endorsement, Add is disabled');

  rows = await search(m, OPEN, '13394001%');
  ok(rows.length === 0 && (await text(m, '#no-results')) === 'No records found.', 'a closed-book number is not found in the open book');
  rows = await search(m, OPEN, '15269999%');
  ok(rows.length === 0, '15269999 is not in the open book');
  await m.goto(`${OPEN}/policy/13394001/LSD/1`);
  ok(m.url().endsWith('/policy-servicing/search') && ((await text(m, '#error-message')) || '').startsWith('20001'), 'opening a closed-book policy in the open book gives 20001 (does not exist)');

  // the happy move in the open book
  await openPolicy(m, OPEN, '102790001001');
  ok((await salesCodes(m, OPEN, '102790001001')).join() === FROM, '102790001001 is on 610901, as the list says');
  await m.goto(`${OPEN}/policy/102790001001`);
  err = await endorseImed(m);
  ok(!err, `Endorse/Alter > Change Primary IMED > Save opens the quote${err ? ': ' + err : ''}`);
  ok(await m.$eval('#nav-requestor-advisor-info', a => a.closest('li').className.includes('scoped')), 'Requestor Advisor Info is greyed (in scope) in the left menu');
  // the dialog's checks
  err = await addAdviser(m, OPEN, '102790001001', { replaces: 0 });
  ok(err && err.startsWith('56410'), `Advisor to be Replaced is mandatory: ${err}`);
  err = await addAdviser(m, OPEN, '102790001001', { look: false, partyCode: 'BNCSMD-100133310' });
  ok(err && err.startsWith('56405'), `a sales code that is not the party's is refused: ${err}`);
  err = await addAdviser(m, OPEN, '102790001001', { primary: 'No' });
  ok(err && err.startsWith('56411'), `replacing the primary adviser needs Primary Flag Yes: ${err}`);
  await m.goto(`${OPEN}/policy/102790001001/requestor-advisor-info`); await step(m, '#btn-add');
  await m.type('#sales-code', TO); await step(m, '#btn-party-lookup');
  ok((await text(m, '#advisor-party-code')) === TO_PARTY && (await text(m, '#distribution-channel')) === 'Personal Finance Advice SA', 'the lookup fills the party code (and channel) from the sales code');
  // Finalise is refused before the new adviser is added
  await m.goto(`${OPEN}/policy/102790001001/acceptance`); await step(m, '#acceptance-serial-1');
  await m.select('#application-accepted', 'Yes'); await m.type('#acceptance-date', '04/08/2026'); await step(m, '#btn-save');
  await m.goto(`${OPEN}/policy/102790001001/quote-summary`);
  for (const b of ['#btn-create-refresh-layer', '#btn-calculate-premium', '#btn-end-sub-endorsement', '#btn-lock-ebq', '#btn-finalise-endorsement']) await step(m, b);
  err = await text(m, '#error-message');
  ok(err && err.startsWith('30412'), `Finalise without a new adviser is refused: ${err}`);
  ok(((await text(m, '#error-message')) || '').startsWith('30412'), 'and the quote stays open');
  await api('POST', '/admin/clear-endorsements', { contractNo: '102790001001' });
  await m.goto(`${OPEN}/policy/102790001001?ctx=policy`);
  await endorseImed(m);
  err = await addAdviser(m, OPEN, '102790001001');
  ok(!err, `Add 620455 replacing 610901 saves${err ? ': ' + err : ''}`);
  ok(((await text(m, '#rai-row-new .rai-change')) || '').includes('replaces 610901') && ((await text(m, '#rai-row-1 .rai-change')) || '') === 'To be replaced', 'the new adviser shows as NEW and the old one as To be replaced');
  await m.click('#rai-check-new'); await step(m, '#btn-delete');
  ok(!(await m.$('#rai-row-new')), 'Delete removes the staged new adviser');
  await addAdviser(m, OPEN, '102790001001');
  let q = await finishQuote(m, OPEN, '102790001001');
  ok(q.finalised === 'FINAL ENDORSEMENT QUOTE' && q.sub === 'Endorsement Submitted', `the quote is finalised and submitted (${q.sub}${q.error ? ', ' + q.error : ''})`);
  await m.goto(`${OPEN}/policy/102790001001/quote-submission`);
  await step(m, '#btn-activate');
  ok(((await text(m, '#error-message')) || '').startsWith('71035'), 'in the open book the Maker cannot activate (71035): a Checker must');
  const c = await (await browser.createBrowserContext()).newPage(); await c.setViewport({ width: 1300, height: 800 });
  await login(c, OPEN, 'dvisser');
  await openPolicy(c, OPEN, '102790001001');
  await step(c, '#nav-endorsement-quotes');
  const serial = await c.$$eval('#endorsement-quotes a.serial', as => as.map(a => a.id).pop());
  await step(c, '#' + serial); await step(c, '#nav-endr-quote-submission'); await step(c, '#btn-activate');
  ok((await text(c, '#hdr-sub-status')) === 'Approved Endorsed Quote', 'the Checker activates it');
  ok((await salesCodes(c, OPEN, '102790001001')).join() === TO, 'after Activate, Requestor Advisor Info shows 620455');

  // ---------------- closed book ----------------
  console.log('\nClosed book (http://localhost:4003)');
  const k = await (await browser.createBrowserContext()).newPage(); await k.setViewport({ width: 1300, height: 800 });
  const r401 = await k.goto(`${CLOSED}/policy-servicing/search`);
  ok(r401.status() === 401 && ((await text(k, '#error-401-title')) || '').includes('401--Unauthorized'), 'a closed-book page opened without logging in gives 401 Unauthorized');
  await login(k, CLOSED, 'nzwane', 'anything');
  ok(k.url().endsWith('/login') && (await text(k, '#error-message')) === 'Invalid username/password; logon denied', 'the open-book password is refused: Invalid username/password; logon denied');
  await login(k, CLOSED, 'nzwane', 'Closed@2026');
  ok(k.url().endsWith('/home') && ((await text(k, '#system-name')) || (await k.content())).includes('BaNCS_V11.0.3.3.16_019.ear'), 'the closed-book password logs in; the system is BaNCS_V11.0.3.3.16_019.ear');
  await k.goto(`${CLOSED}/policy-servicing/search`);
  ok((await text(k, '#search-title')) === 'Quote/Contract/Voucher Search', 'its search is Quote/Contract/Voucher Search');
  rows = await search(k, CLOSED, '15269999%');
  ok(rows.length === 0 && (await text(k, '#no-results')) === 'No Result Found', '15269999 is not in the closed book either: No Result Found (note "Not found")');
  rows = await search(k, CLOSED, '102790001001');
  ok(rows.length === 0, 'an open-book policy is not in the closed book');
  rows = await search(k, CLOSED, '13394001%');
  ok(rows.join() === '13394001/LSD/1,13394001/LSD/2', `the wildcard finds both benefits: ${rows.join(', ')}`);

  await openPolicy(k, CLOSED, '13394002/LSD/1');
  err = await endorseImed(k);
  ok(k.url().endsWith('/policy/13394002/LSD/1/error/already-exist') && err && err.startsWith('56000') && ((await text(k, '#error-hint')) || '').includes('01/11/2026'), 'Endorse/Alter on 13394002/LSD/1 gives 56000: a quote takes effect 01/11/2026 (diarise)');
  await openPolicy(k, CLOSED, '13394003/LSD/1');
  err = await endorseImed(k);
  ok(err && err.startsWith('56020'), `13394003/LSD/1 is lapsed: ${err}`);

  // each benefit separately, then the single-benefit GL Final Expenses policy
  for (const contract of ['13394001/LSD/1', '13394001/LSD/2', '15263901/LSFE/1']) {
    await openPolicy(k, CLOSED, contract);
    ok((await salesCodes(k, CLOSED, contract))[0] === FROM, `${contract}: the primary adviser is 610901`);
    await k.goto(`${CLOSED}/policy/${contract}`);
    err = await endorseImed(k);
    ok(!err, `${contract}: Endorse/Alter > Change Primary IMED opens${err ? ': ' + err : ''}`);
    err = await addAdviser(k, CLOSED, contract);
    ok(!err, `${contract}: 620455 added, replacing 610901${err ? ': ' + err : ''}`);
    q = await finishQuote(k, CLOSED, contract);
    ok(q.sub === 'Endorsement Submitted', `${contract}: submitted (${q.sub}${q.error ? ', ' + q.error : ''})`);
    await k.goto(`${CLOSED}/policy/${contract}/quote-submission`);
    await step(k, '#btn-activate');
    ok((await text(k, '#hdr-sub-status')) === 'Approved Endorsed Quote', `${contract}: the same user activates it (no second person in the closed book)`);
    const after = await salesCodes(k, CLOSED, contract);
    ok(after[0] === TO && !after.includes(FROM), `${contract}: Requestor Advisor Info now shows ${after.join(', ')}`);
  }
  const multi = (await api('GET', '/policies/13394001/LSD/1')).advisers;
  ok(multi.map(a => `${a.salesCode}:${a.share}:${a.primary}`).join() === '620455:60:true,600122:20:false,633310:20:false', 'on the three-adviser benefit only the primary changed; the sharing advisers and shares stay');
  ok((await api('GET', '/mail?to=dvisser')).every(x => !String(x.contractNo).includes('/')), 'the closed book sends no Checker emails');

  await back();
  await api('POST', '/admin/reset');
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
