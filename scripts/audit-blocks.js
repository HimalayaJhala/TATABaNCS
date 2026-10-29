// Walks the screens and checks the parent-block rules a DAP flow relies on:
//  - every input, select and textarea sits in a .field-control inside a .field block (id field-<id>)
//  - every button bar, section, grid and modal is a named block with a stable id
//  - block ids are unique on the page
//  - the Whatfix embed script is in the head of every screen
// Usage: npm run audit:blocks  (needs the demo running)
const puppeteer = require('puppeteer-core');
const { setProfile, applyLatency } = require('./lib/latency');
const B = 'http://localhost:4002', DATA = 'http://localhost:4000', C = '119900001001';
const go = (p, fn) => Promise.all([p.waitForNavigation(), fn()]);

(async () => {
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--host-resolver-rules=MAP *.whatfix.com ~NOTFOUND, MAP whatfix.com ~NOTFOUND'] });
  const restore = await setProfile(browser, 'off');
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 1280, height: 800 });
  let problems = 0, screens = 0, blocks = 0, fields = 0;

  const audit = async label => {
    const r = await p.evaluate(() => {
      const out = { issues: [], blocks: document.querySelectorAll('[data-block]').length, fields: document.querySelectorAll('.field[data-block=field]').length };
      const ctl = [...document.querySelectorAll('#content input:not([type=hidden]):not([type=checkbox]), #content select, #content textarea, .modal-dialog input:not([type=hidden]), .modal-dialog select, .modal-dialog textarea')]
        .filter(e => !e.closest('#dp-month,.dp') && !e.closest('.dp-head') && !e.closest('.grid'));
      for (const e of ctl) {
        const inField = e.closest('.field-control') && e.closest('.field[data-block=field]');
        const inBar = e.closest('.button-bar');
        const inHead = e.closest('.result-head');
        if (!inField && !inBar && !inHead) out.issues.push(`control ${e.id || e.name || e.tagName} is not inside a field block`);
      }
      for (const e of document.querySelectorAll('.btnbar')) if (!e.id || !e.dataset.block) out.issues.push(`button bar without id/data-block near ${(e.querySelector('[id]') || {}).id || '?'}`);
      for (const e of document.querySelectorAll('details.section')) if (!e.id || !e.dataset.block || !e.querySelector(':scope > .section-body')) out.issues.push(`section ${e.id || '(no id)'} lacks a section-body parent`);
      for (const e of document.querySelectorAll('table.grid')) if (!e.closest('.grid-block')) out.issues.push(`grid ${e.id || '(no id)'} is not inside a grid-block`);
      for (const e of document.querySelectorAll('.modal-dialog')) if (!e.dataset.block || !e.querySelector('[data-block=modal-body]')) out.issues.push(`modal ${e.id} is not a full block`);
      const seen = new Set();
      for (const e of document.querySelectorAll('[data-block][id]')) { if (seen.has(e.id)) out.issues.push(`duplicate block id ${e.id}`); seen.add(e.id); }
      if (!document.querySelector('[data-block=screen]')) out.issues.push('no screen block');
      const wf = document.querySelector('head script[src="https://cdn.whatfix.com/prod/e7817f15-91df-440e-906c-959e507b7b6d/embed/embed.nocache.js"]');
      if (!wf || wf.async !== true) out.issues.push('the Whatfix embed script is missing from the page head');
      return out;
    });
    screens++; blocks += r.blocks; fields += r.fields;
    console.log(`${r.issues.length ? 'FAIL' : 'PASS'}  ${label.padEnd(34)} ${String(r.blocks).padStart(3)} blocks, ${String(r.fields).padStart(2)} field blocks${r.issues.length ? '\n        ' + r.issues.join('\n        ') : ''}`);
    problems += r.issues.length;
  };

  await p.goto(B + '/login'); await audit('Login');
  await p.select('#login-user', 'nzwane'); await go(p, () => p.click('#btn-login'));
  await audit('Home');
  await p.goto(B + '/policy-servicing/search'); await audit('Search');
  await p.type('#contract-no', C); await go(p, () => p.click('#btn-search')); await audit('Search results');
  await go(p, () => p.click(`#result-link-${C}`)); await audit('Policy action bar');
  await p.goto(`${B}/policy/${C}/endorse`); await audit('Endorsement Initiation (modal)');
  await p.select('#endorsement-types-available', 'Change Advisor Details'); await p.click('#btn-move-right'); await go(p, () => p.click('#btn-save'));
  await audit('Policy with open endorsement');
  await p.goto(`${B}/policy/${C}/basic-details`); await audit('Basic Details');
  await p.goto(`${B}/policy/${C}/acceptance`); await audit('Acceptance');
  await p.goto(`${B}/policy/${C}/acceptance/1`); await audit('Acceptance Details (modal)');
  await p.goto(`${B}/policy/${C}/quote-summary`); await audit('Endr Quote Summary');
  await p.goto(`${B}/policy/${C}/quote-submission`); await audit('Endr Quote Submission');
  await p.goto(`${B}/policy/${C}/advisor-change`); await audit('Advisor Change');
  await p.goto(`${B}/policy/${C}/sharing/contribution`); await go(p, () => p.click('#btn-share-add')); await audit('Contribution Sharing (modal)');
  await p.goto(`${B}/policy/${C}/sharing/asset`); await audit('Asset Sharing (modal)');
  await p.goto(`${B}/policy/${C}/section/contracting-party`); await audit('Contracting Party');
  await p.goto(`${B}/policy/${C}/section/adviser-info`); await audit('Adviser Info');
  await p.goto(`${B}/policy/${C}?ctx=policy`); await go(p, () => p.click('#nav-endorsement-quotes')); await audit('Endorsement Quotes');

  await restore();
  await browser.close();
  await fetch(DATA + '/admin/reset', { method: 'POST' });
  console.log(`\n${problems ? problems + ' PROBLEMS' : 'ALL BLOCKS OK'}: ${screens} screens, ${blocks} blocks, ${fields} field blocks`);
  process.exit(problems ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
