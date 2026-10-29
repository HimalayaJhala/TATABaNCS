// Tests Browser hang and its timelines, step by step, in a real browser against a running demo (npm run dev).
//   A. every one of the 11 steps hangs for its own Hang time, replacing the profile's wait (profile Stress here, so
//      the normal waits would be 6-90 s): the form carries the time, the step takes that long, and a real input event
//      sent during the freeze goes unanswered until it ends.
//   B. every hang No, profile Off: no step carries a time, none is delayed or frozen.
//   C. the default Hang time (20 s) is past Chrome's ~15 s hung-page limit: a real input event stays unanswered for
//      more than 15 s.
//   D. hang on one step only freezes that step; Normal waits of the other steps still apply.
// Activate is the Checker's, so it never hangs or waits, whatever the table says.
// Usage: npm run test:hang. Resets the data and restores the latency table at the end.
const puppeteer = require('puppeteer-core');
const { applyLatency } = require('./lib/latency');

const B = 'http://localhost:4002', DATA = 'http://localhost:4000', C = '119900001001';
const T = 4;                                                       // seconds of hang in phase A
const KEYS = ['search', 'endorseOpen', 'endorseSave', 'basicSave', 'createLayer', 'calcPremium', 'endSub', 'lockEbq', 'finalise', 'submit', 'activate'];
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const api = (m, u, b) => fetch(DATA + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const text = (p, sel) => p.$eval(sel, e => (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) ? e.value : e.textContent).trim()).catch(() => null);

// Click, wait for the navigation. With `probe`, a real input event goes in 1 s later (through the browser's input
// pipeline, as a mouse would) and we note how long the page took to answer it.
async function timed(p, cdp, sel, { probe = true } = {}) {
  const t0 = Date.now();
  let latency = null;
  const navigated = p.waitForNavigation({ timeout: 150000 });
  await p.click(sel);
  const attr = null;
  if (probe) {
    setTimeout(() => {
      const t = Date.now();
      cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 4, button: 'left', clickCount: 1 })
        .then(() => { latency = Date.now() - t; return cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 4, button: 'left', clickCount: 1 }); })
        .catch(() => {});
    }, 1000);
  }
  await navigated;
  const ms = Date.now() - t0;
  if (probe) await new Promise(r => setTimeout(r, 600));   // let a late answer to the input event arrive
  return { ms, latency, attr };
}
const hangAttr = (p, sel) => p.$eval(sel, el => el.getAttribute('data-hang-ms') || (el.form && el.form.getAttribute('data-hang-ms'))).catch(() => null);

// The whole flow, step by step. `expect(key, m, attr)` is called for each of the 11 steps.
async function walk(browser, expect) {
  await api('POST', '/admin/reset');
  const p = await browser.newPage(); await p.setViewport({ width: 1300, height: 800 });
  const cdp = await p.createCDPSession();
  const login = async (page, user) => { await page.goto(B + '/login'); await page.select('#login-user', user); await Promise.all([page.waitForNavigation(), page.click('#btn-login')]); };
  await login(p, 'nzwane');
  const run = async (key, page, pcdp, sel, probe = true) => {
    const attr = await hangAttr(page, sel);
    const m = await timed(page, pcdp, sel, { probe });
    await expect(key, m, attr);
  };
  await p.goto(B + '/policy-servicing/search'); await p.type('#contract-no', C);
  await run('search', p, cdp, '#btn-search');
  await p.goto(`${B}/policy/${C}?ctx=policy`);
  await run('endorseOpen', p, cdp, '#btn-endorse-alter');
  await p.waitForSelector('#endorse-modal #endorsement-types-available');
  await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right');
  await run('endorseSave', p, cdp, '#btn-save');
  await p.goto(`${B}/policy/${C}/basic-details`);
  await p.click('#vat-inclusive-asset-advice-fee', { clickCount: 3 }); await p.type('#vat-inclusive-asset-advice-fee', '0');
  await run('basicSave', p, cdp, '#btn-save');
  await api('PUT', `/policies/${C}/endorsements/4/acceptance`, { user: 'nzwane', accepted: 'Yes', date: '04/08/2026' });   // Finalise needs the acceptance (no latency of its own)
  await p.goto(`${B}/policy/${C}/quote-summary`);
  for (const [key, sel] of [['createLayer', '#btn-create-refresh-layer'], ['calcPremium', '#btn-calculate-premium'], ['endSub', '#btn-end-sub-endorsement'], ['lockEbq', '#btn-lock-ebq'], ['finalise', '#btn-finalise-endorsement']]) await run(key, p, cdp, sel);
  await p.goto(`${B}/policy/${C}/quote-submission`);
  await p.select('#all-admin-requirements-received', 'Accepted'); await p.select('#reinsurance-verified', 'Yes');
  if (!(await text(p, '#legal-verification'))) await p.select('#legal-verification', 'Approved');
  await Promise.all([p.waitForNavigation(), p.click('#btn-save')]);
  await run('submit', p, cdp, '#btn-submit');
  const q = await browser.newPage(); await q.setViewport({ width: 1300, height: 800 });
  const qcdp = await q.createCDPSession();
  await login(q, 'dvisser');
  await q.goto(`${B}/policy/${C}/endorsement-quotes`);
  await Promise.all([q.waitForNavigation(), q.click('#endr-serial-4')]);
  await q.goto(`${B}/policy/${C}/quote-submission`);
  await run('activate', q, qcdp, '#btn-activate');
  await p.close(); await q.close();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--host-resolver-rules=MAP *.whatfix.com ~NOTFOUND'] });
  const before = await api('GET', '/settings');
  const restore = () => applyLatency(browser, { profile: before.profile, hang: before.hang, hangSeconds: before.hangSeconds, normal: before.normal, stress: before.stress });
  const allSeconds = Object.fromEntries(KEYS.map(k => [k, T]));

  // ---- A. all 11 hang, their own time, profile Stress ----
  console.log(`\nA. every step: hang Yes for ${T} s, profile Stress (the normal waits would be 6-90 s)`);
  await applyLatency(browser, { profile: 'stress', hang: true, hangSeconds: allSeconds });
  const got = (await api('GET', '/settings')).hangMs;
  ok(KEYS.every(k => got[k] === T * 1000), `the server hands every step ${T * 1000} ms: ${JSON.stringify(got)}`);
  const t0 = Date.now();
  const seen = [];
  await walk(browser, async (key, m, attr) => {
    seen.push(key);
    if (key === 'activate') {
      ok(attr === null && m.ms < 2500 && (m.latency === null || m.latency < 1500), `activate (Checker): no hang and no wait, though the table says hang ${T} s (${m.ms} ms)`);
      return;
    }
    ok(attr === String(T * 1000), `${key}: the form carries data-hang-ms=${attr}`);
    ok(m.ms >= T * 1000 - 200 && m.ms <= T * 1000 + 3500, `${key}: the step took ${m.ms} ms, its hang time (${T * 1000} ms), not the profile's wait`);
    ok(m.latency !== null && m.latency >= T * 1000 - 1000 - 400 - 1200, `${key}: a real click sent 1 s in was unanswered for ${m.latency} ms, until the freeze ended`);
  });
  ok(seen.join() === KEYS.join(), 'all 11 steps were exercised, in order');
  console.log(`   (phase A took ${Math.round((Date.now() - t0) / 1000)} s)`);

  // ---- B. all No, profile Off ----
  console.log('\nB. every hang No, profile Off');
  await applyLatency(browser, { profile: 'off', hang: false });
  ok(Object.keys((await api('GET', '/settings')).hangMs).length === 0, 'the server hands out no hang times');
  await walk(browser, async (key, m, attr) => {
    ok(attr === null, `${key}: no data-hang-ms on the form`);
    ok(m.ms < 2500, `${key}: not delayed (${m.ms} ms)`);
    ok(m.latency === null || m.latency < 1500, `${key}: a real click is answered at once (${m.latency} ms)`);
  });

  // ---- D. one step only ----
  console.log('\nD. hang on Calculate Premium only (profile Normal, createLayer 3 s, calcPremium hang 4 s)');
  await applyLatency(browser, { profile: 'normal', hang: { calcPremium: true }, hangSeconds: { calcPremium: T }, normal: { search: 0, endorseOpen: 0, endorseSave: 0, basicSave: 0, createLayer: 3, endSub: 0, lockEbq: 0, finalise: 0, submit: 0, activate: 0, calcPremium: 25 } });
  await walk(browser, async (key, m, attr) => {
    if (key === 'calcPremium') ok(attr === String(T * 1000) && m.ms >= T * 1000 - 200 && m.ms < T * 1000 + 3500, `calcPremium: freezes for ${m.ms} ms (hang ${T * 1000}), not its 25 s Normal wait`);
    else if (key === 'createLayer') ok(attr === null && m.ms >= 2800 && m.ms < 6000 && (m.latency === null || m.latency < 1500), `createLayer: keeps its normal 3 s wait (${m.ms} ms) and does not freeze (click answered in ${m.latency} ms)`);
    else ok(attr === null && m.ms < 2500, `${key}: untouched (${m.ms} ms, no freeze)`);
  });

  // ---- C. the default Hang time ----
  console.log('\nC. the default Hang time (20 s) outlasts the ~15 s Chrome waits before calling a page hung');
  await api('PUT', '/settings/latency', { reset: true });
  const def = await api('GET', '/settings');
  ok(KEYS.every(k => def.hangSeconds[k] === 20 && def.hang[k] === false), 'table defaults: every hang No, every Hang time 20 s');
  await applyLatency(browser, { profile: 'off', hang: { calcPremium: true } });
  ok((await api('GET', '/settings')).hangMs.calcPremium === 20000, 'setting only the switch gives the 20 s default');
  await walk(browser, async (key, m, attr) => {
    if (key !== 'calcPremium') return;
    ok(attr === '20000' && m.ms >= 19800 && m.ms < 24000, `calcPremium took ${m.ms} ms`);
    ok(m.latency !== null && m.latency > 15000, `a real click was unanswered for ${m.latency} ms, longer than Chrome's ~15 s hung-page limit`);
  });

  await restore();
  await api('PUT', '/settings/latency', { reset: true });
  await api('POST', '/admin/reset');
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
