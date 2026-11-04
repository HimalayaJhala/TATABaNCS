// Fee switch-off progress: how many of the targeted contracts have reached a zero fee.
//
// The count is derived from the fee records (store.fees), which only change when an endorsement is activated, so
// it is the committed position, not a quote still waiting for the Checker. A run begins when the first targeted
// fee reaches zero through an activation, and ends when every target is at zero (complete), when the tracking
// window runs out (expired) or when someone stops it (stopped). It can also be started by hand, and restarted after it ends. Reset data clears the run with the rest of the state.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const WINDOW_MINUTES = Number(process.env.FEE_ZERO_WINDOW_MINUTES) > 0 ? Number(process.env.FEE_ZERO_WINDOW_MINUTES) : 60;

const run = () => (store.get().feeZero = store.get().feeZero || { targets: null, startedAt: null, end: null });
const isZero = f => !!f && f.vatInclusive === 0;

// Default scope: the work list's contracts that still carry a fee, so the ones already at zero in the seed are not counted.
function seededTargets() {
  const seeded = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'seed.json'), 'utf8')).fees;
  const owing = new Set(seeded.filter(f => f.vatInclusive > 0).map(f => f.contractNo));
  return store.get().worklist.map(w => w.contractNumber).filter(c => owing.has(c));
}
const targets = () => run().targets || seededTargets();

function progress() {
  const r = run(), list = targets();
  const fees = Object.fromEntries(store.get().fees.map(f => [f.contractNo, f]));
  const zero = list.filter(c => isZero(fees[c]));
  const now = Date.now();
  if (r.startedAt && !r.end) {
    if (zero.length >= list.length && list.length) r.end = { reason: 'complete', at: now };
    else if (now >= r.startedAt + WINDOW_MINUTES * 60000) r.end = { reason: 'expired', at: r.startedAt + WINDOW_MINUTES * 60000 };
    if (r.end) store.save();
  }
  const status = !r.startedAt ? 'idle' : r.end ? r.end.reason : 'running';
  return {
    status, complete: status === 'complete',
    target: list.length, done: zero.length, remaining: list.length - zero.length,
    pending: list.filter(c => !isZero(fees[c])),
    windowMinutes: WINDOW_MINUTES,
    startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
    endedAt: r.end ? new Date(r.end.at).toISOString() : null
  };
}

// Called after an activation has applied its fee. The first targeted contract at zero starts the run.
function feeApplied(contractNo) {
  const r = run();
  if (!r.startedAt && targets().includes(contractNo) && isZero(store.get().fees.find(f => f.contractNo === contractNo))) {
    r.startedAt = Date.now();
  }
  progress();
}

// Begins (or restarts) tracking now, without waiting for the first activation. The window runs from this moment.
function start() {
  const r = run();
  r.startedAt = Date.now(); r.end = null;
  store.save();
  return progress();
}

function stop() {
  const r = run();
  progress();
  if (r.startedAt && !r.end) { r.end = { reason: 'stopped', at: Date.now() }; store.save(); }
  return progress();
}

// contracts: the contract numbers in scope; empty or missing puts the default scope back.
function setTargets(contracts) {
  const known = new Set(store.get().fees.map(f => f.contractNo));
  const list = [...new Set((contracts || []).map(String))];
  const bad = list.filter(c => !known.has(c));
  if (bad.length) return { error: `Unknown contract number(s): ${bad.join(', ')}.` };
  const r = run();
  r.targets = list.length ? list : null;
  r.startedAt = null; r.end = null;
  store.save();
  return { progress: progress() };
}

module.exports = { progress, feeApplied, start, stop, setTargets, WINDOW_MINUTES };
