// data-service (port 4000): stands in for the BaNCS database. The single source of truth for
// BaNCS front-end. JSON in, JSON out; errors are { error: { code, message } }.
const express = require('express');
const store = require('./store');
const rules = require('./rules');
const settings = require('./settings');
const mail = require('./mail');
const feeZero = require('./feezero');

const PORT = Number(process.env.DATA_PORT || 4000);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Closed-book contract numbers carry slashes (13393025/LSD/1, one per benefit). Callers put them in the path as
// they are; this folds the number into one path segment before routing, so /policies/:contractNo still matches.
const SLASHED = /\/(\d{6,10})\/([A-Z]{2,5})\/(\d{1,3})(?=\/|$)/;
app.use((req, res, next) => {
  const q = req.url.indexOf('?');
  const p = q < 0 ? req.url : req.url.slice(0, q);
  req.url = p.replace(SLASHED, '/$1%2F$2%2F$3') + (q < 0 ? '' : req.url.slice(q));
  next();
});

const wrap = fn => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    if (err instanceof rules.BancsError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 99999, message: 'Unexpected system error. Please contact the system administrator.' } });
  }
};

const db = () => store.get();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Latency lives in the API. A Maker's timed step is checked first, so a refusal answers at once, then held for the
// time set in the developer tools, and only then committed: the record changes when the wait is over, not before.
// The check is a dry run that is rolled back (the rules run without awaiting anything, so nothing else sees it).
// The Checker never waits, and neither does a call that names no user. Reads (search) are held after they succeed.
// The wait is reported in X-Latency-Waited-Ms, so the web layer knows to show the result 0.5 s after it arrives.
async function held(key, req, res, work, { mutates = true } = {}) {
  const id = (req.body && req.body.user) || req.query.user;
  const who = id && db().users.find(u => u.id === id);
  const ms = who && who.kind !== 'verifier' ? Math.round(settings.seconds(key) * 1000) : 0;
  if (!ms) return work();
  if (mutates) {
    const before = store.snapshot();
    try { await work(); } finally { store.restore(before); store.save(); }
  } else await work();
  await sleep(ms);
  res.set('X-Latency-Waited-Ms', String(ms));
  return work();
}

function policyView(contractNo) {
  const policy = rules.policy(contractNo);
  return {
    policy,
    fee: rules.fee(contractNo),
    advisers: db().advisers.filter(a => a.contractNo === contractNo),
    endorsements: rules.endorsementsOf(contractNo),
    blocking: rules.blocking(contractNo) || null
  };
}

// This service has no screens; a browser landing here gets pointed at the two front-ends.
app.get('/', (req, res) => res.send(`<!doctype html><meta charset="utf-8"><title>data-service</title>
<body style="font:14px Arial,sans-serif;margin:40px">
<h2>data-service (port ${PORT})</h2><p>This is the dataset API, not an app. Open the front-end:</p>
<ul><li>BaNCS: <a href="http://localhost:4002/login">http://localhost:4002/login</a></li></ul>
<p>Case work list: <code>worklist/Split Fee Cases and Annuities Jul 2026.xlsx</code></p>
<p>Reset the data: <code>npm run reset</code></p></body>`));

app.get('/health', wrap(() => ({ ok: true, latencyProfile: settings.get().profile })));
app.get('/config', wrap(() => ({ ...db().config, latencyProfile: settings.get().profile })));

// Calculation latency, per step. The table is changed only from the BaNCS login page.
app.get('/settings', wrap(() => ({ ...settings.get(), hangMs: settings.hangMs() })));
app.put('/settings/latency', wrap(req => {
  const err = settings.update(req.body || {});
  if (err) throw new rules.BancsError(90001, err, 400);
  const s = settings.get();
  console.log(`[data-service] latency profile: ${s.profile}`);
  return s;
}));

app.get('/users', wrap(() => db().users));
app.get('/users/:id', wrap(req => rules.user(req.params.id)));

app.post('/admin/reset', wrap(() => {
  store.reset();
  console.log(`[data-service] reset to seed at ${new Date().toISOString()}`);
  return { ok: true, resetAt: new Date().toISOString() };
}));

// Clears the endorsement quotes created during the demo (everything that is not in the seed), for one
// contract or all of them, and puts those policies' fee, advisers and record back as the seed has them. The seeded
// history, and the seeded open quotes behind the 56000 cases, stay. Nothing else is reset.
app.post('/admin/clear-endorsements', wrap(req => {
  const contractNo = String((req.body || {}).contractNo || '').trim();
  const seed = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'seed', 'seed.json'), 'utf8'));
  const keep = new Set(seed.endorsements.map(e => e.id));
  const st = store.get();
  const gone = st.endorsements.filter(e => !keep.has(e.id) && (!contractNo || e.contractNo === contractNo));
  const touched = new Set(gone.map(e => e.contractNo));
  st.endorsements = st.endorsements.filter(e => !gone.includes(e));
  for (const c of touched) {
    const swap = (list, key, fromSeed) => { for (let i = list.length - 1; i >= 0; i--) if (list[i][key] === c) list.splice(i, 1); list.push(...fromSeed.filter(x => x[key] === c)); };
    swap(st.fees, 'contractNo', seed.fees);
    swap(st.advisers, 'contractNo', seed.advisers);
    swap(st.policies, 'contractNo', seed.policies);
  }
  if (!contractNo) st.feeZero = null;     // the fees are back at the seed, so the switch-off run starts over
  store.save();
  console.log(`[data-service] cleared ${gone.length} endorsement quote(s)${contractNo ? ' on ' + contractNo : ''}`);
  return { ok: true, cleared: gone.length, contracts: [...touched] };
}));

// Developer tools: puts clean contracts at Endorsement Submitted, waiting for the Checker. Each one is taken through the
// Maker's own steps (Endorse/Alter, fee to 0, Acceptance, the five quote-build steps, Submit) by calling the same rules the
// screens call, with no latency, so the quote, its log, the "Please verify" email and the switch-off count are exactly what
// a person clicking through as the Maker would leave. A contract that already has a quote in progress is skipped and named.
const CHECKER_QUEUE = ['119900001001', '112953094001', '113165622001', '113402518001'];   // the dummy sheet's clean rows 1, 5, 6, 7
app.post('/admin/submit-for-checker', wrap(async () => {
  const maker = db().users.find(u => u.kind === 'capturer');
  const done = [], skipped = [];
  for (const contractNo of CHECKER_QUEUE) {
    try {
      const e = await rules.createEndorsement(contractNo, { user: maker.id, types: ['Change Asset Advice Fee'] });
      await rules.updateFee(contractNo, e.serial, { user: maker.id, vatInclusive: '0' });
      rules.saveAcceptance(contractNo, e.serial, { user: maker.id, accepted: 'Yes', date: db().config.systemDate });
      for (const action of ['create-layer', 'calculate-premium', 'end-sub-endorsement', 'lock-ebq', 'finalise']) {
        await rules.runAction(contractNo, e.serial, action, { user: maker.id });
      }
      const sub = await rules.submit(contractNo, e.serial, { user: maker.id, reinsuranceVerified: 'Yes', allAdminRequirementsReceived: 'Accepted', legalVerification: 'Approved' });
      done.push({ contractNo, serial: sub.serial, quotationNumber: sub.quotationNumber, subStatus: sub.subStatus });
    } catch (err) {
      if (!(err instanceof rules.BancsError)) throw err;
      skipped.push({ contractNo, code: err.code, reason: err.message });
    }
  }
  console.log(`[data-service] ${done.length} contract(s) submitted for the Checker, ${skipped.length} skipped`);
  return { submitted: done, skipped };
}));

// Quote/Contract search. All supplied criteria must match; blank criteria are ignored.
// Quote/Contract search. Every criterion that is filled in must match.
//  - Parameter chooses how the text criteria are matched: Exact match, Starts with, Contains.
//  - A % anywhere in the criterion is a wildcard, as in BaNCS (e.g. 100002558001%).
//  - Status matches the policy's status or the status of any of its endorsement quotes.
//  - Book: each BaNCS only sees its own policies. open (the default), closed, or all.
app.get('/policies', wrap((req, res) => held('search', req, res, () => searchPolicies(req), { mutates: false })));
function searchPolicies(req) {
  const q = req.query;
  const book = q.book || 'open';
  const has = v => v !== undefined && String(v).trim() !== '';
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = (val, crit, dflt) => {
    const c = String(crit).trim().toUpperCase(), v = String(val).toUpperCase();
    if (c.includes('%')) return new RegExp('^' + c.split('%').map(esc).join('.*') + '$').test(v);
    const mode = { 'Exact match': 'exact', 'Starts with': 'starts', 'Contains': 'contains' }[q.parameter] || dflt;
    return mode === 'exact' ? v === c : mode === 'starts' ? v.startsWith(c) : v.includes(c);
  };
  // An open-book contract number is 12 digits. A whole number searched as an exact match that is shorter or longer
  // is refused before the search runs; Starts with, Contains, a % wildcard and closed-book numbers are not checked.
  const cn = String(q.contractNo || '').trim();
  const exact = !q.parameter || q.parameter === 'Exact match';
  if (book !== 'closed' && exact && /^\d+$/.test(cn) && cn.length !== 12) {
    throw new rules.BancsError(21002, `Contract No. ${cn} is not valid: a contract number has 12 digits, ${cn.length} entered.`, 400);
  }
  // Only one person is modelled per policy, so owner, payer and life assured are the same party.
  const stakeOk = !has(q.partyStake) || ['Contract Owner', 'Contribution Payer', 'Life Assured'].includes(q.partyStake);
  return db().policies.filter(p =>
    (book === 'all' || (p.book || 'open') === book) &&
    stakeOk &&
    (!has(q.contractNo) || text(p.contractNo, q.contractNo, 'exact')) &&
    (!has(q.quoteNo) || text(p.quotationNumber, q.quoteNo, 'contains') || rules.endorsementsOf(p.contractNo).some(e => text(e.quotationNumber, q.quoteNo, 'contains'))) &&
    (!has(q.idNo) || text(p.owner.idNumber, q.idNo, 'exact')) &&
    (!has(q.partyCode) || text(p.owner.partyCode, q.partyCode, 'exact')) &&
    (!has(q.product) || text(p.productCode, q.product, 'contains') || text(p.productName, q.product, 'contains')) &&
    (!has(q.status) || p.status === q.status || rules.endorsementsOf(p.contractNo).some(e => e.status === q.status)) &&
    (!has(q.branch) || q.branch === 'ALL' || p.branch === q.branch)
  ).map(p => {
    const last = rules.endorsementsOf(p.contractNo).filter(e => e.status === rules.S.FINAL).pop();
    return { ...p, endrDate: last ? last.effectiveDate : '' };
  });
}


app.get('/policies/:contractNo', wrap(req => policyView(req.params.contractNo)));
app.get('/policies/:contractNo/requester-parties', wrap(req => rules.requesterParties(req.params.contractNo)));
app.get('/policies/:contractNo/endorsements', wrap(req => rules.endorsementsOf(req.params.contractNo)));

app.post('/policies/:contractNo/endorse-check', wrap((req, res) => held('endorseOpen', req, res, () => {
  rules.checkCanEndorse(req.params.contractNo);
  return { ok: true };
}, { mutates: false })));

app.post('/policies/:contractNo/endorsements', wrap((req, res) =>
  held('endorseSave', req, res, () => rules.createEndorsement(req.params.contractNo, req.body))));

app.get('/advisers', wrap(() => rules.advisersMaster()));
// Intermediary register (Intermediary Enquiry): look an adviser up by sales code or party code.
app.get('/intermediaries', wrap(req => (db().intermediaries || []).filter(m =>
  (!req.query.salesCode || m.salesCode === String(req.query.salesCode).trim()) &&
  (!req.query.partyCode || m.partyCode === String(req.query.partyCode).trim().toUpperCase()))));

// Requestor Advisor Info on a Change Primary IMED endorsement: Add (with Advisor to be Replaced) and Delete.
app.put('/policies/:contractNo/endorsements/:serial/adviser-change', wrap(req =>
  rules.stageAdviserChange(req.params.contractNo, req.params.serial, req.body)));
app.delete('/policies/:contractNo/endorsements/:serial/adviser-change', wrap(req =>
  rules.clearAdviserChange(req.params.contractNo, req.params.serial, req.body || {})));
app.get('/sharing-meta', wrap(() => rules.SHARING));

app.put('/policies/:contractNo/endorsements/:serial/sharing/:type', wrap(req =>
  rules.stageSharing(req.params.contractNo, req.params.serial, req.params.type, req.body)));

app.post('/policies/:contractNo/endorsements/:serial/sharing-commit', wrap(req =>
  rules.commitSharing(req.params.contractNo, req.params.serial, req.body)));

app.get('/policies/:contractNo/endorsements/:serial', wrap(req => {
  const e = rules.endorsement(req.params.contractNo, req.params.serial);
  return { ...e, submissionView: rules.submissionOf(e), stepsEnabled: rules.enabledSteps(e) };
}));

app.put('/policies/:contractNo/endorsements/:serial/fee', wrap((req, res) =>
  held('basicSave', req, res, () => rules.updateFee(req.params.contractNo, req.params.serial, req.body))));

app.put('/policies/:contractNo/endorsements/:serial/acceptance', wrap(req =>
  rules.saveAcceptance(req.params.contractNo, req.params.serial, req.body)));

app.post('/policies/:contractNo/endorsements/:serial/actions/:action', wrap((req, res) => {
  const step = rules.STEPS.find(st => st.action === req.params.action);
  const run = () => rules.runAction(req.params.contractNo, req.params.serial, req.params.action, req.body);
  return step ? held(step.latency, req, res, run) : run();
}));

app.put('/policies/:contractNo/endorsements/:serial/submission', wrap(req =>
  rules.saveSubmission(req.params.contractNo, req.params.serial, req.body)));

app.post('/policies/:contractNo/endorsements/:serial/submit', wrap((req, res) =>
  held('submit', req, res, () => rules.submit(req.params.contractNo, req.params.serial, req.body))));

app.post('/policies/:contractNo/endorsements/:serial/activate', wrap((req, res) =>
  held('activate', req, res, () => rules.activate(req.params.contractNo, req.params.serial, req.body))));

app.post('/policies/:contractNo/endorsements/:serial/reject', wrap(req =>
  rules.reject(req.params.contractNo, req.params.serial, req.body)));

// Work list rows as seeded (the Excel workbook is generated from the same rows).
// Fee switch-off progress: targeted contracts at a zero fee, for the live counter in the developer tools.
app.get('/fee-zero/progress', wrap(() => feeZero.progress()));
app.post('/fee-zero/start', wrap(() => feeZero.start()));
app.post('/fee-zero/stop', wrap(() => feeZero.stop()));
app.put('/fee-zero/target', wrap(req => {
  const r = feeZero.setTargets((req.body || {}).contracts);
  if (r.error) throw new rules.BancsError(56013, r.error);
  return r.progress;
}));

app.get('/worklist', wrap(() => db().worklist));
app.get('/transition-list', wrap(() => db().transitionList));

// The mailbox. The BaNCS dev menu and the mail app read and write it here.
app.get('/mail', wrap(req => mail.list(String(req.query.to || ''))));
app.get('/mail/:id', wrap(req => {
  const m = mail.get(req.params.id);
  if (!m) throw new rules.BancsError(90010, `Message ${req.params.id} not found.`, 404);
  return m;
}));
app.post('/mail/:id/read', wrap(req => mail.markRead(req.params.id) || { ok: false }));
app.post('/mail-case', wrap(req => {
  const m = mail.deliverCase(String((req.body || {}).contractNo || ''));
  if (!m) throw new rules.BancsError(90011, 'That contract is not on the work list.', 400);
  return m;
}));

app.listen(PORT, () => console.log(`[data-service] listening on http://localhost:${PORT} (latency profile: ${settings.get().profile}, set on the login page)`));
