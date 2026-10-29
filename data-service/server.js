// data-service (port 4000): stands in for the BaNCS database. The single source of truth for
// BaNCS front-end. JSON in, JSON out; errors are { error: { code, message } }.
const express = require('express');
const store = require('./store');
const rules = require('./rules');
const settings = require('./settings');
const mail = require('./mail');

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

// Waits out one step's configured latency, server-side. BaNCS calls this inside the request the
// browser is waiting on (policy search, Endorse/Alter), so the front end cannot skip it.
app.post('/latency/:key', wrap(async req => {
  if (!settings.known(req.params.key)) throw new rules.BancsError(90002, `Unknown latency step ${req.params.key}.`, 404);
  return { step: req.params.key, waitedMs: await settings.wait(req.params.key) };
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
  store.save();
  console.log(`[data-service] cleared ${gone.length} endorsement quote(s)${contractNo ? ' on ' + contractNo : ''}`);
  return { ok: true, cleared: gone.length, contracts: [...touched] };
}));

// Quote/Contract search. All supplied criteria must match; blank criteria are ignored.
// Quote/Contract search. Every criterion that is filled in must match.
//  - Parameter chooses how the text criteria are matched: Exact match, Starts with, Contains.
//  - A % anywhere in the criterion is a wildcard, as in BaNCS (e.g. 100002558001%).
//  - Status matches the policy's status or the status of any of its endorsement quotes.
//  - Book: each BaNCS only sees its own policies. open (the default), closed, or all.
app.get('/policies', wrap(req => {
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
}));


app.get('/policies/:contractNo', wrap(req => policyView(req.params.contractNo)));
app.get('/policies/:contractNo/requester-parties', wrap(req => rules.requesterParties(req.params.contractNo)));
app.get('/policies/:contractNo/endorsements', wrap(req => rules.endorsementsOf(req.params.contractNo)));

app.post('/policies/:contractNo/endorse-check', wrap(req => {
  rules.checkCanEndorse(req.params.contractNo);
  return { ok: true };
}));

app.post('/policies/:contractNo/endorsements', wrap(req => rules.createEndorsement(req.params.contractNo, req.body)));

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
  return { ...e, submissionView: rules.submissionOf(e) };
}));

app.put('/policies/:contractNo/endorsements/:serial/fee', wrap(req =>
  rules.updateFee(req.params.contractNo, req.params.serial, req.body)));

app.put('/policies/:contractNo/endorsements/:serial/acceptance', wrap(req =>
  rules.saveAcceptance(req.params.contractNo, req.params.serial, req.body)));

app.post('/policies/:contractNo/endorsements/:serial/actions/:action', wrap(req =>
  rules.runAction(req.params.contractNo, req.params.serial, req.params.action, req.body)));

app.put('/policies/:contractNo/endorsements/:serial/submission', wrap(req =>
  rules.saveSubmission(req.params.contractNo, req.params.serial, req.body)));

app.post('/policies/:contractNo/endorsements/:serial/submit', wrap(req =>
  rules.submit(req.params.contractNo, req.params.serial, req.body)));

app.post('/policies/:contractNo/endorsements/:serial/activate', wrap(req =>
  rules.activate(req.params.contractNo, req.params.serial, req.body)));

app.post('/policies/:contractNo/endorsements/:serial/reject', wrap(req =>
  rules.reject(req.params.contractNo, req.params.serial, req.body)));

// Work list rows as seeded (the Excel workbook is generated from the same rows).
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
