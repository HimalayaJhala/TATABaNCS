// bancs-sim (port 4002): stands in for BaNCS IIMS open book, for the Maker. Started with BANCS_BOOK=closed (port 4003) it is the
// closed book instead: a second BaNCS with its own link, login and password, that only sees closed-book policies.
// One login for both personas; in the open book the Checker lands on /checker/home instead of /home, and gets no
// calculation latency or browser hang. Server-rendered, every action is a
// form post and a full page load. Holds no business data: every read and write goes through
// data-service. The session only remembers who is logged in and which endorsement is in context.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { leftNav, topNav, ITEMS } = require('./nav');

const PORT = Number(process.env.BANCS_PORT || 4002);
const DATA = process.env.DATA_URL || 'http://localhost:4000';
const MAIL = process.env.MAIL_URL || 'http://localhost:4001';
const BOOK = process.env.BANCS_BOOK === 'closed' ? 'closed' : 'open';
// Google Sheets can only import from a public address, so the Google Sheets option always reads the hosted site.
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://om-bancs.onrender.com';
const CLOSED = BOOK === 'closed';
// Where a persona lands after login: the Checker's home has its own endpoint in the open book. The closed book has
// no Checker (the same user activates).
const homeOf = u => !CLOSED && u && u.kind === 'verifier' ? '/checker/home' : '/home';

// Express 4 does not catch rejected promises from async route handlers; without this, one failed
// request would crash the process and take the whole demo (and every session) down with it.
const Layer = require('express/lib/router/layer');
Layer.prototype.handle_request = function (req, res, next) {
  if (this.handle.length > 3) return next();
  try {
    const out = this.handle(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) { next(err); }
};

const app = express();
app.set('view engine', 'ejs');
app.locals.F = require('./ui');           // markup helpers: every control gets a parent block
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(__dirname, 'public')));
// Closed-book contract numbers carry slashes (13393025/LSD/1). Links use them as they are; this folds the number
// into one path segment before routing, so /policy/:id still matches and req.params.id is the whole number.
const SLASHED = /\/(\d{6,10})\/([A-Z]{2,5})\/(\d{1,3})(?=\/|$)/;
app.use((req, res, next) => {
  const q = req.url.indexOf('?');
  const p = q < 0 ? req.url : req.url.slice(0, q);
  req.url = p.replace(SLASHED, '/$1%2F$2%2F$3') + (q < 0 ? '' : req.url.slice(q));
  next();
});
// Every screen shows live state. no-store also stops the browser restoring an old copy (with old
// button states) when Back is used.
app.use((req, res, next) => {
  if (!req.path.startsWith('/static')) res.set('Cache-Control', 'no-store');
  next();
});

// ---- data-service client -------------------------------------------------------------------
async function api(method, url, body) {
  const res = await fetch(DATA + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (data && data.error) return { error: data.error };
  return { data };
}
const fmtError = e => `${e.code}*****: ${e.message}`;
// A step's configured latency. The sleep happens in data-service, inside this request, so the browser cannot skip
// or shorten it. The Checker never waits: latency and hang are the Maker's.
const isChecker = req => !!(req.session.user && req.session.user.kind === 'verifier');
const wait = (req, key) => isChecker(req) ? null : api('POST', `/latency/${key}`);
// Runs a step's real work and its latency side by side, so the screen loads for whichever takes longer: a 5 s
// response with 4 s latency loads for 5 s, a 6 s response with 10 s latency loads for 10 s. A step that fails
// answers as soon as the work does.
async function timed(req, key, work) {
  const latency = wait(req, key);
  const r = await work();
  if (!(r && r.error)) await latency;
  return r;
}
const STEP_LATENCY = { 'create-layer': 'createLayer', 'calculate-premium': 'calcPremium', 'end-sub-endorsement': 'endSub', 'lock-ebq': 'lockEbq', finalise: 'finalise' };

// ---- session -------------------------------------------------------------------------------
const fs = require('fs');
// Browsers share cookies across ports, so each book keeps its own cookie and session file.
const COOKIE = CLOSED ? 'BANCS_CB_JSESSIONID' : 'BANCS_JSESSIONID';
const SESSION_FILE = path.join(__dirname, 'data', CLOSED ? 'sessions-cb.json' : 'sessions.json');
const SESSION_MAX_AGE = 12 * 60 * 60;   // seconds

// Sessions live in memory but are written to disk, so restarting the demo does not log anyone out.
const sessions = new Map();
try {
  for (const [sid, sess] of Object.entries(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')))) sessions.set(sid, sess);
} catch (e) { /* first run, or an unreadable file: start clean */ }

// Written straight away (the file is tiny) and again on shutdown, so a restart right after a
// click cannot lose the login. Only logged-in sessions are kept; anonymous ones are throwaway.
function persistSessions() {
  try {
    const keep = Object.fromEntries([...sessions].filter(([, sess]) => sess.user));
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(keep));
  } catch (e) { console.error('could not save sessions:', e.message); }
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { persistSessions(); process.exit(0); });

app.use((req, res, next) => {
  const m = (req.headers.cookie || '').match(new RegExp(`${COOKIE}=([a-f0-9]+)`));
  let sid = m && m[1];
  if (!sid || !sessions.has(sid)) {
    sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, { user: null, ctx: {}, flash: null });
  }
  // Refresh the cookie on every response so an active session never expires mid-demo.
  res.setHeader('Set-Cookie', `${COOKIE}=${sid}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax`);
  req.session = sessions.get(sid);
  res.on('finish', persistSessions);   // after the response, so the page is not slowed down
  next();
});

function flash(req, kind, text, hint) { req.session.flash = { kind, text, hint: hint || null }; }
function takeFlash(req) { const f = req.session.flash; req.session.flash = null; return f; }

// The closed book answers a page opened without logging in with 401 Unauthorized (recording 41:30), not a
// redirect to its login page.
const requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  if (CLOSED) return res.status(401).render('unauthorized');
  res.redirect('/login');
};

let configCache = null;
async function config() {
  if (!configCache) {
    const c = (await api('GET', '/config')).data;
    configCache = CLOSED ? { ...c, systemName: c.closedBook.systemName } : c;
  }
  return configCache;
}

async function render(req, res, view, locals = {}) {
  const f = takeFlash(req);
  // Steps the browser should freeze on (induced client latency in the developer tools); empty when it is off, and
  // always empty for the Checker.
  const hangMs = isChecker(req) ? {} : ((await api('GET', '/settings')).data || {}).hangMs || {};
  res.render(view, {
    config: await config(),
    screen: locals.screen || view,
    user: req.session.user,
    topNav: req.session.user ? topNav(req.session.user.role, locals.topActive || 'policy-servicing') : [],
    error: locals.error || (f && f.kind === 'error' ? f.text : null),
    errorHint: f && f.kind === 'error' ? f.hint : null,
    info: locals.info || (f && f.kind === 'info' ? f.text : null),
    nav: null,
    header: null,
    breadcrumb: null,
    hangMs,
    mailUrl: MAIL,
    book: BOOK, publicUrl: PUBLIC_URL,
    checker: isChecker(req),   // the Checker sees the Maker's capture buttons greyed (rules.js refuses them anyway)
    makerOnly: isChecker(req) ? ' disabled title="Maker step: the Checker verifies the submitted quote"' : '',
    ...locals
  });
}

// ---- policy context ------------------------------------------------------------------------
// Loads the policy and, if one is in context for this session, the endorsement. Builds the
// policy header band and the left navigation.
async function loadCtx(req, contractNo, active) {
  const r = await api('GET', `/policies/${contractNo}`);
  if (r.error) return { error: r.error };
  const view = r.data;
  const serial = req.session.ctx[contractNo];
  let endorsement = null;
  if (serial) {
    const e = await api('GET', `/policies/${contractNo}/endorsements/${serial}`);
    if (!e.error) endorsement = e.data;
    else req.session.ctx[contractNo] = null;   // the quote is gone (e.g. data was reset)
  }
  const p = view.policy;
  // Each book only knows its own policies.
  if ((p.book || 'open') !== BOOK) return { error: { code: 20001, message: `Policy ${contractNo} does not exist.` } };
  const header = endorsement
    ? {
      productName: p.productName, quotationNumber: endorsement.quotationNumber,
      status: endorsement.status, currency: p.currency, policyLabel: 'Parent Policy Number',
      policyNumber: p.contractNo, policyLink: `/policy/${p.contractNo}?ctx=policy`, subStatus: endorsement.subStatus
    }
    : {
      productName: p.productName, quotationNumber: p.quotationNumber, status: p.status,
      currency: p.currency, policyLabel: 'Policy Number', policyNumber: p.contractNo, policyLink: null,
      subStatus: p.subStatus
    };
  const nav = leftNav(p.productCode, p.contractNo, endorsement, active);
  return { ...view, endorsement, header, nav };
}

// Endorsement action bar, as in the SOP screenshots: every button keeps its place and id, only
// the next valid step is enabled, and the first slot changes from Create or Refresh Layer to
// Calculate Premium. Once finalised the bar shrinks to the post-submission set.
const BAR_BUTTONS = {
  'create-layer': ['btn-create-refresh-layer', 'Create or Refresh Layer'],
  'calculate-premium': ['btn-calculate-premium', 'Calculate Premium'],
  'start-sub-endorsement': ['btn-start-sub-endorsement', 'Start Sub Endorsement'],
  'finalise': ['btn-finalise-endorsement', 'Finalise Endorsement'],
  'lock-ebq': ['btn-lock-ebq', 'Lock EBQ'],
  'end-sub-endorsement': ['btn-end-sub-endorsement', 'End Sub Endorsement'],
  'eac': ['btn-eac', 'EAC'],
  'reject-sub-alteration': ['btn-reject-sub-alteration', 'Reject Sub Alteration'],
  'reject-endorsed-quote': ['btn-reject-endorsed-quote', 'Reject Endorsed Quote'],
  'follow-up-report': ['btn-follow-up-report', 'Follow up report'],
  'endorsement-detail': ['btn-endorsement-detail', 'Endorsement Detail']
};

const BAR_BY_STAGE = {
  //            slots in screen order                                   enabled
  started: [['create-layer', 'finalise', 'lock-ebq', 'end-sub-endorsement'], ['create-layer']],
  layer: [['calculate-premium', 'start-sub-endorsement', 'finalise', 'lock-ebq', 'end-sub-endorsement'], ['calculate-premium', 'endorsement-detail']],
  premium: [['start-sub-endorsement', 'finalise', 'lock-ebq', 'end-sub-endorsement'], ['end-sub-endorsement']],
  subEnded: [['start-sub-endorsement', 'finalise', 'lock-ebq', 'end-sub-endorsement'], ['start-sub-endorsement', 'lock-ebq']],
  locked: [['start-sub-endorsement', 'finalise', 'lock-ebq', 'end-sub-endorsement'], ['finalise']]
};
const ALWAYS_ON = ['eac', 'reject-sub-alteration', 'reject-endorsed-quote', 'follow-up-report'];

const NEXT_STEP = { started: 'Create or Refresh Layer', layer: 'Calculate Premium', premium: 'End Sub Endorsement', subEnded: 'Lock EBQ', locked: 'Finalise Endorsement' };
const STEP_ACTIONS_SET = ['create-layer', 'calculate-premium', 'start-sub-endorsement', 'end-sub-endorsement', 'lock-ebq', 'finalise'];

function actionBar(e, onSummary, checker) {
  // A greyed step button says what to press instead (hover tooltip).
  const next = e.stage === 'premium' && e.calc && e.calc.stale ? 'Calculate Premium' : NEXT_STEP[e.stage];
  const tip = (action, enabled) => (!enabled && STEP_ACTIONS_SET.includes(action) && next ? `Not available yet. Next step: ${next}` : '');
  // The Checker can only reject a submitted quote; every other step on this bar is the Maker's.
  const checkerMay = action => action === 'follow-up-report' || action === 'eac' || (action === 'reject-endorsed-quote' && e.stage === 'submitted');
  const button = (action, enabled) => {
    if (checker && !checkerMay(action)) return { action, id: BAR_BUTTONS[action][0], label: BAR_BUTTONS[action][1], enabled: false, tip: 'Maker step: the Checker verifies the submitted quote' };
    return { action, id: BAR_BUTTONS[action][0], label: BAR_BUTTONS[action][1], enabled, tip: tip(action, enabled) };
  };
  if (e.stage === 'finalised') return [button('reject-endorsed-quote', true), button('follow-up-report', true)];
  // Submitted and waiting for the Checker: the quote can still be rejected; Activate is on Endr Quote Submission.
  if (e.stage === 'submitted') return [button('reject-endorsed-quote', true), button('follow-up-report', true)];
  if (['approved', 'rejected'].includes(e.stage)) return [button('follow-up-report', true)];
  let [slots, enabled] = BAR_BY_STAGE[e.stage];
  // After a fee change the calculation is out of date: Calculate Premium opens again and End Sub waits for it.
  if (e.stage === 'premium' && e.calc && e.calc.stale) {
    slots = ['calculate-premium', ...slots];
    enabled = enabled.filter(a => a !== 'end-sub-endorsement').concat('calculate-premium');
  }
  // Policy Action Details shows the same bar without the first (layer/premium) slot.
  const shown = onSummary ? slots : slots.filter(a => a !== 'create-layer' && a !== 'calculate-premium');
  return [
    ...shown.map(a => button(a, enabled.includes(a))),
    ...ALWAYS_ON.map(a => button(a, true)),
    button('endorsement-detail', enabled.includes('endorsement-detail'))
  ];
}

function needEndorsement(req, res, ctx) {
  if (ctx.endorsement) return true;
  flash(req, 'error', fmtError({ code: 56005, message: 'No endorsement quote is open for this policy. Use Endorse/Alter or select a quote from Endorsement Quotes.' }));
  res.redirect(`/policy/${ctx.policy.contractNo}`);
  return false;
}

// ---- login / landing -----------------------------------------------------------------------
app.get('/favicon.ico', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, 'public', 'favicon.ico')); });
app.get('/', (req, res) => res.redirect(req.session.user ? homeOf(req.session.user) : '/login'));
app.get('/IIMS', (req, res) => res.redirect('/'));
app.get('/IIMS/', (req, res) => res.redirect('/'));
if (!CLOSED) {
  app.get(['/IIMS/checker', '/IIMS/checker/'], (req, res) => res.redirect(req.session.user ? homeOf(req.session.user) : '/login'));
}

app.get('/login', async (req, res) => {
  const users = (await api('GET', '/users')).data;
  const latency = (await api('GET', '/settings')).data;
  await render(req, res, 'login', { users, latency });
});

// The one place the calculation latency can be changed: profile, the per-step table and the browser-hang switch.
app.post('/login/latency', async (req, res) => {
  const body = req.body.op === 'defaults'
    ? { reset: true }
    : { profile: req.body.profile, hang: req.body.hang, hangSeconds: req.body.hangSeconds, normal: req.body.normal, stress: req.body.stress };
  const r = await api('PUT', '/settings/latency', body);
  if (r.error) flash(req, 'error', fmtError(r.error));
  else flash(req, 'info', req.body.op === 'defaults' ? 'Latency settings restored to their defaults.' : `Latency settings saved. Profile ${r.data.profile.charAt(0).toUpperCase() + r.data.profile.slice(1)}; induced client latency on ${Object.values(r.data.hang).filter(Boolean).length} of ${r.data.steps.length} steps.`);
  res.redirect('/login');
});

// Developer menu: the synthetic work list (worklist/), to test with in place of the client's sheet.
const DUMMY_DATA = {
  xlsx: 'Split Fee Cases and Annuities Aug 2026-synthetic.xlsx',
  pdf: 'Split Fee Cases and Annuities Aug 2026-synthetic.pdf',
  'transition-xlsx': 'Relationship Transition List Aug 2026-synthetic.xlsx',
  'transition-pdf': 'Relationship Transition List Aug 2026-synthetic.pdf'
};
// The first tab of a work list as CSV, for the developer tools' Google Sheets option (IMPORTDATA reads it).
const DUMMY_CSV = { csv: DUMMY_DATA.xlsx, 'transition-csv': DUMMY_DATA['transition-xlsx'] };
app.get('/login/dummy-data/:kind(csv|transition-csv)', async (req, res) => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '..', 'worklist', DUMMY_CSV[req.params.kind]));
  const ws = wb.worksheets[0];
  const cell = v => { const s = v === null || v === undefined ? '' : String(v && v.richText ? v.richText.map(t => t.text).join('') : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [];
  ws.eachRow({ includeEmpty: true }, row => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) { const x = row.getCell(c); vals.push(x.isMerged && x.master !== x ? '' : cell(x.value)); }   // a merged title once
    lines.push(vals.join(','));
  });
  res.type('text/csv').send(lines.join('\n') + '\n');
});
app.get('/login/dummy-data/:kind', (req, res) => {
  const name = DUMMY_DATA[req.params.kind];
  if (!name) return res.status(404).end();
  res.download(path.join(__dirname, '..', 'worklist', name), name);
});

app.post('/login', async (req, res) => {
  const u = await api('GET', `/users/${encodeURIComponent(req.body.user || '')}`);
  if (u.error) {
    flash(req, 'error', fmtError({ code: 10002, message: 'Invalid user. Please select a user.' }));
    return res.redirect('/login');
  }
  // The closed book has its own password; the open book's login does not work there.
  if (CLOSED && req.body.password !== (await config()).closedBook.password) {
    flash(req, 'error', 'Invalid username/password; logon denied');
    return res.redirect('/login');
  }
  req.session.user = u.data;
  req.session.ctx = {};
  res.redirect(homeOf(u.data));
});

app.get('/logout', (req, res) => {
  req.session.user = null;
  req.session.ctx = {};
  res.redirect('/login');
});

// Demo control: restores the seed. Bound to Reset data in the developer menu and Ctrl+Alt+R.
app.post('/admin/reset', async (req, res) => {
  await api('POST', '/admin/reset');
  for (const s of sessions.values()) s.ctx = {};
  flash(req, 'info', 'Demo data reset to the starting point. The latency table was kept.');
  res.redirect(req.session.user ? '/home' : '/login');
});

// Each persona has one home endpoint; the other one redirects there.
app.get('/home', requireLogin, (req, res) => homeOf(req.session.user) === '/home' ? render(req, res, 'home') : res.redirect(homeOf(req.session.user)));
if (!CLOSED) app.get('/checker/home', requireLogin, (req, res) => homeOf(req.session.user) === '/checker/home' ? render(req, res, 'home') : res.redirect('/home'));

app.get('/business-operations', requireLogin, (req, res) =>
  render(req, res, 'module', { topActive: 'work-items', title: 'Work Items', breadcrumb: 'Home > Work Items' }));

app.get('/module/:slug', requireLogin, (req, res) => {
  const t = topNav(req.session.user.role).find(x => x.slug === req.params.slug);
  const title = t ? t.label : 'Business Operations';
  render(req, res, 'module', { topActive: req.params.slug, title, breadcrumb: `Home > ${title}` });
});

// ---- Quote/Contract search (screens 2, 3) --------------------------------------------------
const SEARCH_FIELDS = ['product', 'quoteNo', 'dateFrom', 'dateTo', 'status', 'partyStakeName', 'parameter',
  'branchCode', 'contractNo', 'partyCode', 'idNo'];

app.get('/policy-servicing/search', requireLogin, (req, res) =>
  render(req, res, 'search', { criteria: { branchCode: 'ALL' }, results: null, breadcrumb: null }));

async function doSearch(req, res, src) {
  const criteria = {};
  for (const f of SEARCH_FIELDS) criteria[f] = (src[f] || '').trim();
  if (!criteria.branchCode) criteria.branchCode = 'ALL';
  const any = ['product', 'quoteNo', 'contractNo', 'partyCode', 'idNo', 'status'].some(f => criteria[f]);
  if (!any) {
    return render(req, res, 'search', {
      criteria, results: null,
      error: fmtError({ code: 21001, message: 'Please enter at least one search criterion.' })
    });
  }
  const qs = new URLSearchParams({
    contractNo: criteria.contractNo, quoteNo: criteria.quoteNo, idNo: criteria.idNo,
    partyCode: criteria.partyCode, product: criteria.product, status: criteria.status,
    partyStake: criteria.partyStakeName, parameter: criteria.parameter, branch: criteria.branchCode, book: BOOK
  });
  const r = await timed(req, 'search', () => api('GET', `/policies?${qs}`));
  render(req, res, 'search', { criteria, results: r.data || [], error: r.error ? fmtError(r.error) : null });
}

app.post('/policy-servicing/results', requireLogin, (req, res) => doSearch(req, res, req.body));
app.get('/policy-servicing/results', requireLogin, (req, res) => doSearch(req, res, req.query));

// ---- Policy action bar (screen 4) ----------------------------------------------------------
app.get('/policy/:id', requireLogin, async (req, res) => {
  if (req.query.ctx === 'policy') req.session.ctx[req.params.id] = null;
  const ctx = await loadCtx(req, req.params.id, 'policy-action-details');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  render(req, res, 'policy', {
    ...ctx, bar: ctx.endorsement ? actionBar(ctx.endorsement, false, isChecker(req)) : null,
    breadcrumb: 'Home > Policy Servicing > Policy Action Details'
  });
});

const NOT_AVAILABLE = {
  'cancel-policy': 'Cancel Policy', 'premium-transaction': 'Premium Transaction', 'follow-up-report': 'Follow-up Report',
  'premium-projection': 'Premium Projection', 'eac': 'EAC', 'continue': 'Continue', 'endorsement-detail': 'Endorsement Detail',
  'reject-sub-alteration': 'Reject Sub Alteration', 'start-sub-endorsement': 'Start Sub Endorsement',
  'cool-off': 'Cool Off'
};

app.post('/policy/:id/action/:name', requireLogin, (req, res) => {
  const label = NOT_AVAILABLE[req.params.name];
  flash(req, 'info', `${label || req.params.name} is not enabled in this environment.`);
  res.redirect(req.get('referer') || `/policy/${req.params.id}`);
});

// Endorse/Alter. The server checks for a transaction in progress (56000); if clear, the policy
// page is shown again with the Endorsement Initiation Screen as a modal over it.
// 56000 is raised when the policy already has an endorsement in progress. The BaNCS message stays exactly
// as it is (Seek reads it); the hint under it says which quote is in the way and how to carry on.
async function blockedHint(contractNo) {
  const b = ((await api('GET', `/policies/${contractNo}`)).data || {}).blocking;
  if (!b) return null;
  const quote = `Endorsement quote ${b.quotationNumber}`;
  const link = { linkText: 'Open Endorsement Quotes', href: `/policy/${contractNo}/endorsement-quotes` };
  if (b.status === 'DRAFT ENDORSEMENT QUOTE') {
    return { ...link, text: `${quote} is still open on this policy (${b.status}, ${b.subStatus || 'in progress'}). Only one endorsement can be in progress at a time. Continue it from Endorsement Quotes by clicking serial ${b.serial}, or cancel it with Reject Endorsed Quote.` };
  }
  if (b.stage !== 'approved') {
    return { ...link, text: `${quote} has been submitted (${b.subStatus || b.status}) and is waiting for another user to activate it. Once it is activated or rejected, a new endorsement can be started.` };
  }
  return { ...link, text: `${quote} is approved but only takes effect on ${b.effectiveDate}, so a new endorsement cannot be started on this policy until then.` };
}

// The 56000 page. Its own URL, so a DAP flow can branch on it: /policy/<contract no.>/error/already-exist.
// It is worked out from the policy's live state, so a refresh or a pasted link shows the same thing, and
// if nothing is blocking any more it goes back to the policy.
app.get('/policy/:id/error/already-exist', requireLogin, async (req, res) => {
  const id = req.params.id;
  const r = await api('POST', `/policies/${id}/endorse-check`);
  if (!r.error || r.error.code !== 56000) return res.redirect(`/policy/${id}`);
  req.session.ctx[id] = null;                         // the policy view, as on the Endorse/Alter screen
  const ctx = await loadCtx(req, id, 'policy-action-details');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  render(req, res, 'policy', {
    ...ctx, bar: null, screen: 'error-already-exist',
    error: fmtError(r.error), errorHint: await blockedHint(id),
    breadcrumb: 'Home > Policy Servicing > Policy Action Details'
  });
});

app.post('/policy/:id/endorse-alter', requireLogin, async (req, res) => {
  if (isChecker(req)) {
    flash(req, 'error', fmtError({ code: 71037, message: `Endorse/Alter is a Maker step. The Checker (${req.session.user.role}) verifies a submitted quote and activates or rejects it.` }));
    return res.redirect(`/policy/${req.params.id}`);
  }
  const r = await timed(req, 'endorseOpen', () => api('POST', `/policies/${req.params.id}/endorse-check`));
  if (r.error) {
    if (r.error.code === 56000) return res.redirect(`/policy/${req.params.id}/error/already-exist`);
    flash(req, 'error', fmtError(r.error));
    return res.redirect(`/policy/${req.params.id}`);
  }
  res.redirect(`/policy/${req.params.id}/endorse`);
});

// ---- Endorsement Initiation Screen (screen 5, popup window) --------------------------------
// The closed book's list, as in the recording (46:00).
const CLOSED_ENDORSEMENT_TYPES = [
  ['Update Non-Rating Factor Life Covered Details'], ['Change Correspondent'], ['Change Primary IMED'],
  ['Replace Sharing Intermediary'], ['Remove Sharing Intermediary'], ['Add New Sharing Intermediary'],
  ['Update Commission Sharing Details'], ['Pay Arrear Premium'], ['Bank deduction Cancellation only'],
  ['Salary deduction Cancellation Only'], ['Add No Dealings'], ['Remove No Dealings'], ['Add Beneficiary']
];
const ENDORSEMENT_TYPES = [
  ['Restart Regular Contribution'], ['Change Payment Method'], ['Waive Premium due to Contribution Protection Claim'],
  ['Change Contribution Payer'], ['Outright Cession'], ['Add Security Cession'], ['Remove Security Cession'],
  ['Update Contracting Party Details'], ['Change Correspondent'], ['Change Payer Bank Account or Payroll Details'],
  ['Bank Collection Cancellation Only'], ['Payroll Collection Cancellation Only'], ['Transfer Out'],
  ['Update Transfer Details'], ['Change Premium Collection Day'], ['Add Lump Sum Contribution'],
  ['Update Contribution Details'], ['Change Date of Birth Retrospectively due to Error Correction', true],
  ['Change Gender Retrospectively due to Error Correction', true],
  ['Change Professional Qualification Retrospectively due to Error correction', true],
  ['Change Marital Status Retrospectively due to Error correction', true],
  ['Change Income / Net Assets Retrospectively due to Error correction', true],
  ['Change Answers to Underwriting Questionnaires Retrospectively due to Error Correction', true],
  ['Change Education Retrospectively due to Error correction', true],
  ['Underwriting Review (Territorial) For Error Correction', true],
  ['Underwriting Review (Avocational) For Error Correction', true],
  ['Underwriting Review (Health) For Error Correction', true],
  ['Underwriting Review (Financial) For Error Correction', true],
  ['Underwriting Review (Occupational) For Error Correction', true],
  ['Repay Outstanding Contributions'],
  ['Change Advisor Details'], ['Replacement Marker Error Correction'],
  ['Contribution Based Remuneration Error Correction'], ['Asset Based Remuneration Error Correction'],
  ['Restart Collection'], ['Change Primary IMED'], ['Replace Sharing Intermediary'],
  ['Remove Sharing Intermediary'], ['Add Sharing Intermediary']
];

async function renderEndorse(req, res, extra = {}) {
  req.session.ctx[req.params.id] = null;   // initiating from the policy, not from an open quote
  const ctx = await loadCtx(req, req.params.id, 'policy-action-details');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  render(req, res, 'policy', {
    ...ctx, bar: null, breadcrumb: 'Home > Policy Servicing > Policy Action Details',
    modal: { types: CLOSED ? CLOSED_ENDORSEMENT_TYPES : ENDORSEMENT_TYPES, selected: [], form: {}, error: null, parties: (await api('GET', `/policies/${req.params.id}/requester-parties`)).data, ...extra }
  });
}

app.get('/policy/:id/endorse', requireLogin, async (req, res) => {
  const r = await api('POST', `/policies/${req.params.id}/endorse-check`);
  if (r.error) {
    if (r.error.code === 56000) return res.redirect(`/policy/${req.params.id}/error/already-exist`);
    flash(req, 'error', fmtError(r.error));
    return res.redirect(`/policy/${req.params.id}`);
  }
  renderEndorse(req, res);
});

app.post('/policy/:id/endorse', requireLogin, async (req, res) => {
  const selected = [].concat(req.body.types || []).filter(Boolean);
  const r = await timed(req, 'endorseSave', () => api('POST', `/policies/${req.params.id}/endorsements`, {
    user: req.session.user.id, types: selected, quoteDate: req.body.quoteDate,
    laterEffectiveDate: req.body.laterEffectiveDate, instanceNumber: req.body.instanceNumber,
    bizagiCaseId: req.body.bizagiCaseId, carmaKey: req.body.carmaKey,
    laterDate: req.body.laterDate, requesterParty: req.body.requesterParty,
    requesterStakeCode: req.body.requesterStakeCode, quoteRequired: req.body.quoteRequired,
    occupationChange: req.body.occupationChange, reason: req.body.reason
  }));
  // Errors stay inside the modal so the user can correct and save again.
  if (r.error) return renderEndorse(req, res, { error: fmtError(r.error), selected, form: req.body });
  req.session.ctx[req.params.id] = r.data.serial;
  res.redirect(`/policy/${req.params.id}`);
});

// ---- Basic Details (screen 6) --------------------------------------------------------------
app.get('/policy/:id/basic-details', requireLogin, async (req, res) => {
  const ctx = await loadCtx(req, req.params.id, 'basic-details');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  const e = ctx.endorsement;
  const shown = e && e.pendingFee ? e.pendingFee : ctx.fee;
  const feeEditable = !!(e && e.status === 'DRAFT ENDORSEMENT QUOTE' && ['started', 'layer', 'premium', 'subEnded'].includes(e.stage));
  const base = ctx.policy.basic;
  const vals = { noDealings: base.noDealings || 'No', amendPotReason: base.amendPotReason || '', removeReason: base.removeReason || '', ...((e && e.pendingBasic) || {}) };
  render(req, res, 'basic-details', {
    ...ctx, shownFee: shown, feeEditable, basicVals: vals,
    amendReasons: ['Customer request', 'Error correction', 'Change of adviser', 'Regulatory requirement'],
    breadcrumb: 'Home > Policy Servicing > Basic Details'
  });
});

app.post('/policy/:id/basic-details', requireLogin, async (req, res) => {
  const serial = req.session.ctx[req.params.id];
  if (!serial) {
    flash(req, 'error', fmtError({ code: 56010, message: 'Basic Details cannot be modified outside an endorsement. Please initiate Endorse/Alter.' }));
    return res.redirect(`/policy/${req.params.id}/basic-details`);
  }
  const r = await timed(req, 'basicSave', () => api('PUT', `/policies/${req.params.id}/endorsements/${serial}/fee`, {
    user: req.session.user.id, vatInclusive: req.body.vatInclusive,
    noDealings: req.body.noDealings, amendPotReason: req.body.amendPotReason, removeReason: req.body.removeReason
  }));
  // BaNCS just refreshes the page on success; only errors are shown.
  if (r.error) flash(req, 'error', fmtError(r.error));
  res.redirect(`/policy/${req.params.id}/basic-details`);
});

// ---- Acceptance (screen 9) -----------------------------------------------------------------
app.get('/policy/:id/acceptance', requireLogin, async (req, res) => {
  const ctx = await loadCtx(req, req.params.id, 'acceptance');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  render(req, res, 'acceptance', { ...ctx, breadcrumb: 'Home > Policy Servicing > Acceptance' });
});

// Acceptance Details is a modal over the Acceptance screen, in the same tab.
async function renderAcceptanceModal(req, res, extra = {}) {
  const ctx = await loadCtx(req, req.params.id, 'acceptance');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  const a = (ctx.endorsement && ctx.endorsement.acceptance) || {};
  render(req, res, 'acceptance', {
    ...ctx, breadcrumb: 'Home > Policy Servicing > Acceptance',
    modal: { form: { accepted: a.accepted || 'Yes', date: a.date || '' }, error: null, ...extra }
  });
}

app.get('/policy/:id/acceptance/:serialNo', requireLogin, (req, res) => renderAcceptanceModal(req, res));

app.post('/policy/:id/acceptance/:serialNo', requireLogin, async (req, res) => {
  const serial = req.session.ctx[req.params.id];
  if (!serial) {
    return renderAcceptanceModal(req, res, {
      error: fmtError({ code: 56005, message: 'No endorsement quote is open for this policy.' }), form: req.body
    });
  }
  const r = await api('PUT', `/policies/${req.params.id}/endorsements/${serial}/acceptance`, {
    user: req.session.user.id, accepted: req.body.accepted, date: req.body.date
  });
  // Errors stay inside the modal; on success the Acceptance list refreshes with the new values.
  if (r.error) return renderAcceptanceModal(req, res, { error: fmtError(r.error), form: req.body });
  res.redirect(`/policy/${req.params.id}/acceptance`);
});

// ---- Advisor Change (split commission SOP) ---------------------------------------------------
// The screen lists three Details buttons; the two sharing tables open as modals over it. A dialog's
// Save stages rows on the endorsement; Save on this screen commits them.
let sharingMetaCache = null;
async function sharingMeta() {
  if (!sharingMetaCache) sharingMetaCache = (await api('GET', '/sharing-meta')).data;
  return sharingMetaCache;
}

const SALE_EVENTS = ['ALL', 'New Business', 'Top Up', 'Renewal'];
const num = n => (n == null || n === '' ? '' : Number(n).toFixed(2));

// Greyed rows are the policy's current advisers (Latest Indicator OLD); the rest are new records.
function currentSharingRows(type, advisers) {
  return advisers.map(a => ({
    saleEvent: 'New Business', advisor: a.partyCode, label: `${a.partyCode}-->${a.name}`, primary: a.primary ? 'Yes' : 'No',
    v: type === 'contribution'
      ? [num(a.share), num(a.share), num(a.share), num(a.share)]
      : ['', '', num(a.share), num(a.share), '', ''],
    indicator: 'OLD'
  }));
}

function rowsFromBody(body, count) {
  const rows = [];
  const src = body.rows || {};
  const idx = Object.keys(src).map(Number).sort((x, y) => x - y);
  for (const i of idx) {
    const r = src[i] || {};
    rows.push({ sel: !!r.sel, saleEvent: r.saleEvent || 'ALL', advisor: r.advisor || '', primary: r.primary || '', v: Array.from({ length: count }, (_, k) => ((r.v || {})[k] ?? '')) });
  }
  return rows;
}

async function renderAdvisorChange(req, res, opts = {}) {
  const id = req.params.id;
  const ctx = await loadCtx(req, id, 'advisor-change');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  if (!needEndorsement(req, res, ctx)) return;
  let modal;
  if (opts.type) {
    const meta = (await sharingMeta())[opts.type];
    const e = ctx.endorsement;
    const saved = (e.sharingDraft && e.sharingDraft[opts.type]) || (e.sharing && e.sharing[opts.type]) || [];
    const rows = opts.rows || saved.map(r => ({ ...r, sel: false }));
    const advisers = (await api('GET', '/advisers')).data;
    modal = {
      type: opts.type, meta, error: opts.error || null, saleEvents: SALE_EVENTS, advisers,
      current: currentSharingRows(opts.type, ctx.advisers),
      rows: rows.map(r => ({ ...r, indicator: 'NEW' }))
    };
  }
  render(req, res, 'advisor-change', { ...ctx, modal, breadcrumb: 'Home > Policy Servicing > Advisor Change' });
}

app.get('/policy/:id/advisor-change', requireLogin, (req, res) => renderAdvisorChange(req, res));

// Save on the Advisor Change screen commits what the dialogs staged.
app.post('/policy/:id/advisor-change', requireLogin, async (req, res) => {
  const id = req.params.id, serial = req.session.ctx[id];
  if (!serial) { flash(req, 'error', fmtError({ code: 56005, message: 'No endorsement quote is open for this policy.' })); return res.redirect(`/policy/${id}`); }
  const r = await api('POST', `/policies/${id}/endorsements/${serial}/sharing-commit`, { user: req.session.user.id });
  if (r.error) flash(req, 'error', fmtError(r.error));
  res.redirect(`/policy/${id}/advisor-change`);
});

app.post('/policy/:id/advisor-change/:name', requireLogin, (req, res) => {
  flash(req, 'info', `${req.params.name === 'contribution-percentage' ? 'Edit Contribution Remuneration Percentage' : req.params.name} is not enabled in this environment.`);
  res.redirect(`/policy/${req.params.id}/advisor-change`);
});

app.get('/policy/:id/sharing/:type', requireLogin, (req, res) => {
  if (!['contribution', 'asset'].includes(req.params.type)) return res.redirect(`/policy/${req.params.id}/advisor-change`);
  renderAdvisorChange(req, res, { type: req.params.type });
});

app.post('/policy/:id/sharing/:type', requireLogin, async (req, res) => {
  const id = req.params.id, type = req.params.type;
  if (!['contribution', 'asset'].includes(type)) return res.redirect(`/policy/${id}/advisor-change`);
  const meta = (await sharingMeta())[type];
  let rows = rowsFromBody(req.body, meta.cols.length);
  const op = req.body.op;
  if (op === 'add') {
    rows.push({ sel: false, saleEvent: 'ALL', advisor: '', primary: '', v: meta.cols.map(() => '') });
    return renderAdvisorChange(req, res, { type, rows });
  }
  if (op === 'delete') {
    rows = rows.filter(r => !r.sel);
    return renderAdvisorChange(req, res, { type, rows });
  }
  const serial = req.session.ctx[id];
  if (!serial) { flash(req, 'error', fmtError({ code: 56005, message: 'No endorsement quote is open for this policy.' })); return res.redirect(`/policy/${id}`); }
  const r = await api('PUT', `/policies/${id}/endorsements/${serial}/sharing/${type}`, { user: req.session.user.id, rows });
  // Errors stay inside the dialog; on success the Advisor Change screen is shown again.
  if (r.error) return renderAdvisorChange(req, res, { type, rows, error: fmtError(r.error) });
  res.redirect(`/policy/${id}/advisor-change`);
});

// ---- Endr Quote Summary (screen 10) --------------------------------------------------------
app.get('/policy/:id/quote-summary', requireLogin, async (req, res) => {
  const ctx = await loadCtx(req, req.params.id, 'endr-quote-summary');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  if (!needEndorsement(req, res, ctx)) return;
  render(req, res, 'quote-summary', {
    ...ctx, bar: actionBar(ctx.endorsement, true, isChecker(req)), breadcrumb: 'Home > Policy Servicing > Endr Quote Summary'
  });
});

const STEP_ACTIONS = ['create-layer', 'calculate-premium', 'end-sub-endorsement', 'lock-ebq', 'finalise'];

app.post('/policy/:id/quote-summary/:action', requireLogin, async (req, res) => {
  const id = req.params.id;
  const serial = req.session.ctx[id];
  const back = `/policy/${id}/quote-summary`;
  if (!serial) {
    flash(req, 'error', fmtError({ code: 56005, message: 'No endorsement quote is open for this policy.' }));
    return res.redirect(`/policy/${id}`);
  }
  const action = req.params.action;
  let r;
  if (STEP_ACTIONS.includes(action)) {
    r = await timed(req, STEP_LATENCY[action], () => api('POST', `/policies/${id}/endorsements/${serial}/actions/${action}`, { user: req.session.user.id }));
  } else if (action === 'reject-endorsed-quote') {
    r = await api('POST', `/policies/${id}/endorsements/${serial}/reject`, { user: req.session.user.id });
  } else {
    flash(req, 'info', `${NOT_AVAILABLE[action] || action} is not enabled in this environment.`);
    return res.redirect(back);
  }
  if (r.error) flash(req, 'error', fmtError(r.error));
  res.redirect(req.body.returnTo === 'policy' ? `/policy/${id}` : back);
});

// ---- Endr Quote Submission (screen 11) -----------------------------------------------------
app.get('/policy/:id/quote-submission', requireLogin, async (req, res) => {
  const ctx = await loadCtx(req, req.params.id, 'endr-quote-submission');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  if (!needEndorsement(req, res, ctx)) return;
  render(req, res, 'quote-submission', {
    ...ctx, form: ctx.endorsement.submissionView,
    breadcrumb: 'Home > New Business > Application Data Capture > Endr Quote Submission'
  });
});

const SUBMISSION_FIELDS = ['reinsuranceVerified', 'sarInProgress', 'uwRequirementsOutstanding',
  'allAdminRequirementsReceived', 'uwMlqCompleteDate', 'uwAllReqmtRecvdDate', 'spousalConsentCaptured',
  'adminRequirementsOutstanding', 'applicationSubStatus', 'uwNewReqmtDate', 'legalVerification'];

app.post('/policy/:id/quote-submission', requireLogin, async (req, res) => {
  const id = req.params.id;
  const serial = req.session.ctx[id];
  const here = `/policy/${id}/quote-submission`;
  if (!serial) {
    flash(req, 'error', fmtError({ code: 56005, message: 'No endorsement quote is open for this policy.' }));
    return res.redirect(`/policy/${id}`);
  }
  const body = { user: req.session.user.id };
  for (const f of SUBMISSION_FIELDS) if (f in req.body) body[f] = req.body[f];
  const base = `/policies/${id}/endorsements/${serial}`;
  const op = req.body.op;
  let r;
  if (op === 'save') r = await api('PUT', `${base}/submission`, body);
  else if (op === 'submit') r = await timed(req, 'submit', () => api('POST', `${base}/submit`, body));
  else if (op === 'activate') r = await timed(req, 'activate', () => api('POST', `${base}/activate`, body));
  else if (op === 'reject') r = await api('POST', `${base}/reject`, body);
  else { flash(req, 'error', fmtError({ code: 48000, message: 'Unknown operation.' })); return res.redirect(here); }

  if (r.error) { flash(req, 'error', fmtError(r.error)); return res.redirect(here); }
  // Submit, Activate and Reject return to the Endorsement Summary screen, as in the SOP.
  if (op === 'submit' || op === 'activate' || op === 'reject') return res.redirect(`/policy/${id}/quote-summary`);
  res.redirect(here);
});

// ---- Endorsement Quotes (screen 12) --------------------------------------------------------
app.get('/policy/:id/endorsement-quotes', requireLogin, async (req, res) => {
  req.session.ctx[req.params.id] = null;
  const ctx = await loadCtx(req, req.params.id, 'endorsement-quotes');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  render(req, res, 'endorsement-quotes', { ...ctx, breadcrumb: 'Home > Policy Servicing > Endorsement Quotes' });
});

app.get('/policy/:id/endorsement-quotes/:serial', requireLogin, async (req, res) => {
  const r = await api('GET', `/policies/${req.params.id}/endorsements/${req.params.serial}`);
  if (r.error) { flash(req, 'error', fmtError(r.error)); return res.redirect(`/policy/${req.params.id}/endorsement-quotes`); }
  req.session.ctx[req.params.id] = r.data.serial;
  res.redirect(`/policy/${req.params.id}/quote-summary`);
});

// ---- Requestor Advisor Info (transition list, recording 45:30-52:30) -----------------------
// The policy's advisers. On a Change Primary IMED endorsement, Add opens the "Basic Information" dialog: the new
// adviser (party code, found from the sales code with the lookup), and the adviser it replaces. The new adviser
// shows as a NEW row until Activate swaps them over. Delete removes that staged row.
async function renderRequestorAdvisor(req, res, modal = null) {
  const ctx = await loadCtx(req, req.params.id, 'requestor-advisor-info');
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  const e = ctx.endorsement;
  render(req, res, 'requestor-advisor-info', {
    ...ctx, change: e && !['approved', 'rejected'].includes(e.stage) ? e.adviserChange : null, modal,   // once activated, the advisers themselves show it
    imedOpen: !!(e && e.status === 'DRAFT ENDORSEMENT QUOTE' && e.types.includes('Change Primary IMED')),
    breadcrumb: 'Home > Policy Servicing > Requestor Advisor Info'
  });
}

const ADD_FIELDS = ['partyCode', 'salesCode', 'salesCodeType', 'typeOfAdvisor', 'distributionChannel', 'primaryFlag', 'replaces'];
const addModal = (form = {}, error = null) => ({
  form, error, salesCodeTypes: [['0', '0'], ['1', '1']], advisorTypes: ['Broker', 'Tied Agent', 'Franchise'],
  channels: ['Personal Finance Advice SA', 'Broker Distribution', 'MFC Direct SA']
});

app.get('/policy/:id/requestor-advisor-info', requireLogin, (req, res) => renderRequestorAdvisor(req, res));

app.post('/policy/:id/requestor-advisor-info', requireLogin, async (req, res) => {
  const id = req.params.id, here = `/policy/${id}/requestor-advisor-info`;
  const serial = req.session.ctx[id];
  const op = req.body.op;
  if (op === 'add' || op === 'delete') {
    // Outside a Change Primary IMED endorsement there is nothing to change yet.
    const e = serial && (await api('GET', `/policies/${id}/endorsements/${serial}`)).data;
    if (!e || e.status !== 'DRAFT ENDORSEMENT QUOTE' || !e.types.includes('Change Primary IMED')) {
      flash(req, 'error', fmtError({ code: 56401, message: 'Requestor Advisor Info can only be changed on a Change Primary IMED endorsement. Use Endorse/Alter on Policy Action Details first.' }));
      return res.redirect(here);
    }
    if (op === 'add') return renderRequestorAdvisor(req, res, addModal());
    if (!req.body.selNew) {
      flash(req, 'error', fmtError({ code: 56412, message: 'Select the new adviser row to delete. Existing advisers are replaced with Add and Advisor to be Replaced.' }));
      return res.redirect(here);
    }
    const r = await api('DELETE', `/policies/${id}/endorsements/${serial}/adviser-change`, { user: req.session.user.id });
    if (r.error) flash(req, 'error', fmtError(r.error));
    return res.redirect(here);
  }
  res.redirect(here);
});

// The Add dialog: Search fills the party code from the sales code (Intermediary Enquiry); Save stages the change.
app.post('/policy/:id/requestor-advisor-info/add', requireLogin, async (req, res) => {
  const id = req.params.id;
  const serial = req.session.ctx[id];
  const form = Object.fromEntries(ADD_FIELDS.map(f => [f, String(req.body[f] || '').trim()]));
  if (!serial) {
    flash(req, 'error', fmtError({ code: 56005, message: 'No endorsement quote is open for this policy.' }));
    return res.redirect(`/policy/${id}`);
  }
  if (req.body.op === 'lookup') {
    const code = form.salesCode.replace(/^0+(?=\d{6}$)/, '');
    const m = code && ((await api('GET', `/intermediaries?salesCode=${encodeURIComponent(code)}`)).data || [])[0];
    if (!m) return renderRequestorAdvisor(req, res, addModal(form, fmtError({ code: 56403, message: `No adviser found for Sales Code ${form.salesCode || '(blank)'}.` })));
    return renderRequestorAdvisor(req, res, addModal({ ...form, partyCode: m.partyCode, salesCode: m.salesCode, distributionChannel: form.distributionChannel || m.distributionChannel }));
  }
  const r = await api('PUT', `/policies/${id}/endorsements/${serial}/adviser-change`, { user: req.session.user.id, ...form });
  if (r.error) return renderRequestorAdvisor(req, res, addModal(form, fmtError(r.error)));
  res.redirect(`/policy/${id}/requestor-advisor-info`);
});

// ---- Generic left-nav sections -------------------------------------------------------------
app.get('/policy/:id/section/:slug', requireLogin, async (req, res) => {
  const ctx = await loadCtx(req, req.params.id, req.params.slug);
  if (ctx.error) { flash(req, 'error', fmtError(ctx.error)); return res.redirect('/policy-servicing/search'); }
  const title = ITEMS[req.params.slug] || 'Details';
  render(req, res, 'section', { ...ctx, title, slug: req.params.slug, breadcrumb: `Home > Policy Servicing > ${title}` });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(`<pre>99999*****: ${err.message}</pre>`);
});

process.on('unhandledRejection', err => console.error('unhandled rejection:', err));
app.listen(PORT, () => console.log(`[bancs-sim] ${CLOSED ? 'closed book' : 'open book'} listening on http://localhost:${PORT}`));
