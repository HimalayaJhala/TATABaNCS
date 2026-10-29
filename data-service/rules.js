// Business rules taken from the SWITCHING OFF FEES SOP. Every rule is enforced here, never in
// the browser. Errors carry a BaNCS-style numeric code that is rendered as "<code>*****: <msg>".
const store = require('./store');
const settings = require('./settings');
const mail = require('./mail');
const calc = require('./calc');

class BancsError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const S = {
  ACTIVE: 'ACTIVE POLICY',
  DRAFT: 'DRAFT ENDORSEMENT QUOTE',
  FINAL: 'FINAL ENDORSEMENT QUOTE',
  REJECTED: 'REJECTED ENDORSEMENT QUOTE'
};

const SUB = {
  started: 'Sub-Endorsement Started',
  layer: 'Sub-Endorsement Started',
  premium: 'Sub-Endorsement Started',
  subEnded: 'Sub-Endorsement End',
  locked: 'Endorsement Quote Locked',
  finalised: 'Endorsement Submission Pending',
  submitted: 'Endorsement Submitted',
  approved: 'Approved Endorsed Quote'
};

// Endr Quote Summary actions, in the order the SOP requires.
const STEPS = [
  { action: 'create-layer', label: 'Create or Refresh Layer', from: ['started', 'layer'], to: 'layer', latency: 'createLayer' },
  { action: 'calculate-premium', label: 'Calculate Premium', from: ['layer', 'premium'], to: 'premium', latency: 'calcPremium' },
  { action: 'end-sub-endorsement', label: 'End Sub Endorsement', from: ['premium'], to: 'subEnded', latency: 'endSub' },
  { action: 'lock-ebq', label: 'Lock EBQ', from: ['subEnded'], to: 'locked', latency: 'lockEbq' },
  { action: 'finalise', label: 'Finalise Endorsement', from: ['locked'], to: 'finalised', latency: 'finalise' }
];

const STEP_ERRORS = {
  'create-layer': [30401, 'Create or Refresh Layer cannot be performed at the current stage of the endorsement quote.'],
  'calculate-premium': [30402, 'Calculate Premium cannot be performed. Create or Refresh Layer has not been completed for this endorsement.'],
  'end-sub-endorsement': [30403, 'End Sub Endorsement cannot be performed. Premium has not been calculated for this endorsement.'],
  'lock-ebq': [30404, 'Lock EBQ cannot be performed. Premium has not been calculated and the sub endorsement has not been ended.'],
  'finalise': [30405, 'Finalise Endorsement cannot be performed. The EBQ has not been locked.']
};

// Advisor Change > Edit Contribution / Asset Remuneration Sharing (split commission SOP).
// Rows are staged by the dialog's Save and committed by Save on the Advisor Change screen.
const SHARING = {
  contribution: {
    label: 'Contribution Remuneration Sharing',
    cols: ['Contribution Commission Share', 'Contribution Commission (Fig) Share', 'As-and-when advice fee share', 'As-and-when advice fee (fig) share'],
    required: [0, 2]
  },
  asset: {
    label: 'Asset Remuneration Sharing',
    cols: ['Asset adviser fee share', 'Asset adviser fee (fig) share', 'Asset advice fee share', 'Asset advice fee (fig) share', 'Asset commission share', 'Asset commission (fig) share'],
    required: [2]
  }
};

function advisersMaster() {
  const seen = new Map();
  for (const a of store.get().advisers) if (!seen.has(a.partyCode)) seen.set(a.partyCode, a);
  return [...seen.values()].map(a => ({ partyCode: a.partyCode, salesCode: a.salesCode, name: a.name, type: a.type, segment: a.segment, distributionChannel: a.distributionChannel }));
}

function stageSharing(contractNo, serial, type, body) {
  const u = user(body.user);
  const meta = SHARING[type];
  if (!meta) throw new BancsError(56300, `Unknown remuneration sharing type ${type}.`, 400);
  const e = endorsement(contractNo, serial);
  requireOpen(e);
  if (!e.types.includes('Change Advisor Details')) {
    throw new BancsError(56301, 'Remuneration sharing can only be changed on a Change Advisor Details endorsement.');
  }
  if (['subEnded', 'locked'].includes(e.stage)) {
    throw new BancsError(56011, 'Advisor Change cannot be modified after the sub endorsement has ended.');
  }
  const master = advisersMaster();
  const rows = (body.rows || []).map(r => ({
    saleEvent: r.saleEvent || 'ALL', advisor: r.advisor || '', primary: r.primary || '',
    v: meta.cols.map((_, i) => String((r.v || [])[i] ?? '').trim())
  }));
  if (!rows.length) throw new BancsError(56302, `Add at least one record to ${meta.label}.`);
  const seen = new Set();
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r.advisor || !master.some(m => m.partyCode === r.advisor)) throw new BancsError(56303, `Row ${n}: Advisor Code is mandatory. Please select an adviser.`);
    if (seen.has(r.advisor)) throw new BancsError(56304, `Row ${n}: adviser ${r.advisor} appears more than once.`);
    seen.add(r.advisor);
    if (!['Yes', 'No'].includes(r.primary)) throw new BancsError(56305, `Row ${n}: Primary Adviser is mandatory.`);
    meta.cols.forEach((c, k) => {
      const v = r.v[k];
      if (v === '' ) { if (meta.required.includes(k)) throw new BancsError(56306, `Row ${n}: ${c} is mandatory.`); return; }
      const x = Number(v);
      if (!Number.isFinite(x) || x < 0 || x > 100) throw new BancsError(56307, `Row ${n}: ${c} must be a number between 0 and 100.`);
    });
  });
  if (rows.filter(r => r.primary === 'Yes').length !== 1) {
    throw new BancsError(56308, 'Exactly one adviser must be marked as the Primary Adviser.');
  }
  meta.cols.forEach((c, k) => {
    const filled = rows.filter(r => r.v[k] !== '');
    if (!filled.length) return;
    const total = Math.round(filled.reduce((t, r) => t + Number(r.v[k]), 0) * 100) / 100;
    if (total !== 100) throw new BancsError(56309, `${c} must add up to 100.00 across advisers; it currently adds up to ${total.toFixed(2)}.`);
  });
  e.sharingDraft = { ...(e.sharingDraft || {}), [type]: rows };
  log(e, u.id, `sharing staged ${type}: ${rows.map(r => r.advisor + '=' + r.v.join('/')).join(', ')}`);
  store.save();
  return e;
}

// After the split, the remaining adviser must still receive the same fee, so the fee the client pays
// is scaled by that adviser's asset advice fee share (0.575 at 50% -> 0.287, as in the SOP).
// "Remaining adviser" = the policy's current primary adviser if still on the new split, otherwise the new primary.
function expectedSplitFee(e) {
  const sharing = e.sharing || {};
  const rows = sharing.asset || sharing.contribution;
  if (!rows) return null;
  const col = 2;                                   // "Asset advice fee share" / "As-and-when advice fee share"
  const current = store.get().advisers.find(a => a.contractNo === e.contractNo && a.primary);
  const kept = rows.find(r => current && r.advisor === current.partyCode) || rows.find(r => r.primary === 'Yes');
  if (!kept || kept.v[col] === '') return null;
  const base = fee(e.contractNo).vatInclusive;
  return { retained: kept.advisor, share: Number(kept.v[col]), base, expected: Math.floor(base * Number(kept.v[col]) / 100 * 1000 + 1e-9) / 1000 };
}

function commitSharing(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  requireOpen(e);
  if (!e.types.includes('Change Advisor Details')) {
    throw new BancsError(56301, 'Remuneration sharing can only be changed on a Change Advisor Details endorsement.');
  }
  const draft = e.sharingDraft || {};
  if (!Object.keys(draft).length && !Object.keys(e.sharing || {}).length) {
    throw new BancsError(56310, 'Nothing to save. Use Details to add the new adviser split first.');
  }
  e.sharing = { ...(e.sharing || {}), ...draft };
  e.sharingDraft = {};
  // The fee follows the split, so work it out now and stage it. Basic Details then already shows the
  // right VAT Inclusive / Exclusive pair (still editable); Save there confirms or overrides it.
  const x = expectedSplitFee(e);
  if (x) {
    const current = fee(contractNo);
    e.pendingFee = {
      vatInclusive: x.expected, vatExclusive: r3(x.expected / (1 + cfg().vatRate)), effectiveDate: e.effectiveDate,
      previous: { vatInclusive: current.vatInclusive, vatExclusive: current.vatExclusive }
    };
    log(e, u.id, `fee calculated from split ${current.vatInclusive} x ${x.share}% -> ${x.expected}`);
    if (e.calc) e.calc.stale = true;
  }
  log(e, u.id, 'advisor change saved');
  store.save();
  return e;
}

// ---- Change Primary IMED: Requestor Advisor Info > Add, with "Advisor to be Replaced" (recording 50:20-52:30).
// The new adviser is staged on the endorsement and only replaces the old one on Activate.
const IMED_TYPE = 'Change Primary IMED';
const SALES_CODE_TYPES = ['0', '1'];
const DISTRIBUTION_CHANNELS = ['Personal Finance Advice SA', 'Broker Distribution', 'MFC Direct SA'];
const ADVISOR_TYPES = ['Broker', 'Tied Agent', 'Franchise'];

function stageAdviserChange(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  requireOpen(e);
  if (!e.types.includes(IMED_TYPE)) {
    throw new BancsError(56401, 'Requestor Advisor Info can only be changed on a Change Primary IMED endorsement.');
  }
  if (['subEnded', 'locked', 'finalised'].includes(e.stage)) {
    throw new BancsError(56011, 'Requestor Advisor Info cannot be modified after the sub endorsement has ended.');
  }
  const t = v => String(v ?? '').trim();
  const partyCode = t(body.partyCode).toUpperCase(), salesCode = t(body.salesCode);
  if (!partyCode) throw new BancsError(56402, 'Advisor Party Code is mandatory.');
  const m = (store.get().intermediaries || []).find(x => x.partyCode === partyCode);
  if (!m) throw new BancsError(56403, `Advisor Party Code ${partyCode} does not exist.`);
  if (!salesCode) throw new BancsError(56404, 'Sales Code is mandatory.');
  if (m.salesCode !== salesCode.replace(/^0+(?=\d{6}$)/, '')) throw new BancsError(56405, `Sales Code ${salesCode} does not belong to adviser ${partyCode} (${m.name}).`);
  if (!SALES_CODE_TYPES.includes(t(body.salesCodeType))) throw new BancsError(56406, 'Sales Code Type is mandatory.');
  if (!DISTRIBUTION_CHANNELS.includes(t(body.distributionChannel))) throw new BancsError(56407, 'Distribution Channel is mandatory.');
  if (!['Yes', 'No'].includes(t(body.primaryFlag))) throw new BancsError(56408, 'Primary Flag is mandatory.');
  const current = store.get().advisers.filter(a => a.contractNo === contractNo);
  if (current.some(a => a.partyCode === partyCode)) throw new BancsError(56409, `Adviser ${partyCode} is already on this policy.`);
  const replaced = current.find(a => a.id === t(body.replaces));
  if (!replaced) throw new BancsError(56410, 'Advisor to be Replaced is mandatory. Select the adviser the new one takes over from.');
  if ((t(body.primaryFlag) === 'Yes') !== replaced.primary) {
    throw new BancsError(56411, replaced.primary
      ? 'The adviser being replaced is the primary adviser, so Primary Flag must be Yes.'
      : 'The adviser being replaced is not the primary adviser, so Primary Flag must be No.');
  }
  e.adviserChange = {
    add: {
      partyCode, salesCode: m.salesCode, name: m.name, salesCodeType: t(body.salesCodeType),
      type: ADVISOR_TYPES.includes(t(body.typeOfAdvisor)) ? t(body.typeOfAdvisor) : 'Broker',
      distributionChannel: t(body.distributionChannel), primary: t(body.primaryFlag) === 'Yes'
    },
    replaces: replaced.id
  };
  log(e, u.id, `adviser change staged: ${replaced.salesCode} -> ${m.salesCode}`);
  store.save();
  return e;
}

function clearAdviserChange(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  requireOpen(e);
  if (!e.adviserChange) throw new BancsError(56412, 'Select the new adviser row to delete. Existing advisers are replaced with Add and Advisor to be Replaced.');
  if (['subEnded', 'locked', 'finalised'].includes(e.stage)) {
    throw new BancsError(56011, 'Requestor Advisor Info cannot be modified after the sub endorsement has ended.');
  }
  e.adviserChange = null;
  log(e, u.id, 'adviser change deleted');
  store.save();
  return e;
}

const toKey = d => (d || '').split('/').reverse().join('');
const r3 = n => Math.round(n * 1000) / 1000;

function cfg() { return store.get().config; }

function user(id) {
  const u = store.get().users.find(x => x.id === id);
  if (!u) throw new BancsError(10001, 'User session is not valid. Please log in again.', 401);
  return u;
}

function policy(contractNo) {
  const p = store.get().policies.find(x => x.contractNo === contractNo);
  if (!p) throw new BancsError(20001, `Policy ${contractNo} does not exist.`, 404);
  return p;
}

function endorsementsOf(contractNo) {
  return store.get().endorsements.filter(e => e.contractNo === contractNo).sort((a, b) => a.serial - b.serial);
}

function endorsement(contractNo, serial) {
  const e = store.get().endorsements.find(x => x.contractNo === contractNo && x.serial === Number(serial));
  if (!e) throw new BancsError(20002, `Endorsement quote ${serial} does not exist for policy ${contractNo}.`, 404);
  return e;
}

function fee(contractNo) {
  return store.get().fees.find(f => f.contractNo === contractNo);
}

// An endorsement still in flight, or a finalised one that takes effect after the system date,
// blocks a new Endorse/Alter (error 56000).
function blocking(contractNo) {
  const sys = toKey(cfg().systemDate);
  return endorsementsOf(contractNo).find(e =>
    e.status === S.DRAFT ||
    (e.status === S.FINAL && e.stage !== 'approved') ||
    (e.status === S.FINAL && toKey(e.effectiveDate) > sys));
}

function checkCanEndorse(contractNo) {
  const p = policy(contractNo);
  // A lapsed policy cannot be endorsed (the transition list's "can't move because of the lapsed status").
  if (p.status !== S.ACTIVE) {
    throw new BancsError(56020, `Endorsement cannot be initiated. The policy status is ${p.status}; only an ACTIVE POLICY can be endorsed.`);
  }
  if (blocking(contractNo)) {
    throw new BancsError(56000, 'This transaction cannot be processed as financial or Special Non-Financial transactions is already in progress.');
  }
}

function log(e, userId, action) {
  e.log.push({ at: new Date().toISOString(), user: userId, action });
}

const STAKE_CODES = ['Contract Owner', 'Contribution Payer', 'Adviser'];
const AMEND_POT_REASONS = ['Customer request', 'Error correction', 'Change of adviser', 'Regulatory requirement'];
const validDate = d => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d || '').trim());
  if (!m) return false;
  const x = new Date(+m[3], +m[2] - 1, +m[1]);
  return x.getFullYear() === +m[3] && x.getMonth() === +m[2] - 1 && x.getDate() === +m[1];
};

// Who can be the requester depends on the stake the request comes from.
function requesterParties(contractNo) {
  const p = policy(contractNo), o = p.owner;
  const owner = `${o.partyCode} - ${o.firstName} ${o.lastName}`;
  return {
    'Contract Owner': [owner],
    'Contribution Payer': [owner],
    'Adviser': store.get().advisers.filter(a => a.contractNo === contractNo).map(a => `${a.partyCode} - ${a.name}`)
  };
}

async function createEndorsement(contractNo, body) {
  const u = user(body.user);
  checkCanEndorse(contractNo);
  const types = [].concat(body.types || []).filter(Boolean);
  if (!types.length) throw new BancsError(56101, 'Please select at least one Type of Endorsement.');
  const p = policy(contractNo);
  const serial = endorsementsOf(contractNo).reduce((m, e) => Math.max(m, e.serial), 0) + 1;
  const date = (body.quoteDate || '').trim() || cfg().systemDate;
  if (!validDate(date)) throw new BancsError(56103, 'Endorsement Quote Date must be a valid date in DD/MM/YYYY format.');
  // A later effective date makes the endorsement future-dated; it must be after the system date.
  const later = body.laterEffectiveDate === 'Yes';
  const laterDate = (body.laterDate || '').trim();
  if (later && !validDate(laterDate)) throw new BancsError(56102, 'Later Effective Date is mandatory and must be a valid date in DD/MM/YYYY format.');
  if (later && toKey(laterDate) <= toKey(cfg().systemDate)) throw new BancsError(56105, `Later Effective Date must be after the system date ${cfg().systemDate}.`);
  const stake = body.requesterStakeCode || 'Contract Owner';
  if (!STAKE_CODES.includes(stake)) throw new BancsError(56104, 'Requester Stake Code is not valid.');
  const parties = requesterParties(contractNo)[stake];
  const party = body.requesterParty && parties.includes(body.requesterParty) ? body.requesterParty : parties[0];
  const e = {
    id: `${contractNo}-${serial}`, contractNo, serial,
    quotationNumber: `${contractNo}${String(serial).padStart(4, '0')}`,
    types, effectiveDate: later ? laterDate : date, quoteDate: date,
    status: S.DRAFT, subStatus: SUB.started, stage: 'started',
    coolingOffApplicable: 'No', coolOffFlag: 'No',
    capturedBy: u.id, submittedBy: null, activatedBy: null,
    instanceNumber: body.instanceNumber || '99999',
    bizagiCaseId: body.bizagiCaseId || 'NA',
    carmaKey: body.carmaKey || 'NA',
    requesterStakeCode: stake,
    requesterParty: party,
    laterEffectiveDate: later ? 'Yes' : 'No',
    quoteRequired: body.quoteRequired || 'Yes',
    occupationChange: body.occupationChange || 'No',
    reason: body.reason || '',
    pendingFee: null, acceptance: null,
    submission: null,
    log: []
  };
  log(e, u.id, 'create');
  store.get().endorsements.push(e);
  store.save();
  return e;
}

function requireOpen(e) {
  if (e.status !== S.DRAFT) {
    throw new BancsError(56010, 'Details cannot be modified. The endorsement quote is not in DRAFT status.');
  }
}

// VAT Exclusive is derived from VAT Inclusive, never entered.
async function updateFee(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  requireOpen(e);
  if (['locked', 'finalised'].includes(e.stage)) {
    throw new BancsError(56011, 'Basic Details cannot be modified after the EBQ has been locked.');
  }
  // The SOP says "update to 0%", so tolerate a % sign, stray spaces and a comma decimal.
  const raw = String(body.vatInclusive ?? '').replace(/[%\s]/g, '').replace(',', '.');
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n) || n < 0) {
    throw new BancsError(56012, 'VAT Inclusive Asset Advice Fee must be a number greater than or equal to zero.');
  }
  const noDealings = body.noDealings || (e.pendingBasic && e.pendingBasic.noDealings) || 'No';
  if (!['No', 'Yes'].includes(noDealings)) throw new BancsError(56013, 'No Dealings must be Yes or No.');
  const amend = body.amendPotReason ?? ((e.pendingBasic && e.pendingBasic.amendPotReason) || '');
  if (amend !== '' && !AMEND_POT_REASONS.includes(amend)) throw new BancsError(56014, 'Amend Pot Percentage Reason is not valid.');
  e.pendingBasic = { noDealings, amendPotReason: amend, removeReason: String(body.removeReason ?? (e.pendingBasic && e.pendingBasic.removeReason) ?? '').slice(0, 250) };
  const current = fee(contractNo);
  e.pendingFee = {
    vatInclusive: r3(n),
    vatExclusive: r3(n / (1 + cfg().vatRate)),
    effectiveDate: e.effectiveDate,
    previous: { vatInclusive: current.vatInclusive, vatExclusive: current.vatExclusive }
  };
  log(e, u.id, `fee ${current.vatInclusive} -> ${e.pendingFee.vatInclusive}`);
  if (e.calc) e.calc.stale = true;
  // A correction after End Sub Endorsement reopens the quote: Calculate Premium and End Sub Endorsement run again.
  if (e.stage === 'subEnded') { e.stage = 'premium'; e.subStatus = SUB.premium; }
  store.save();
  return e;
}

function saveAcceptance(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  requireOpen(e);
  if (!['Yes', 'No'].includes(body.accepted)) throw new BancsError(56201, 'Application Accepted is mandatory.');
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(body.date || '')) throw new BancsError(56202, 'Acceptance Date is mandatory and must be in DD/MM/YYYY format.');
  e.acceptance = { accepted: body.accepted, date: body.date };
  log(e, u.id, `acceptance ${body.accepted} ${body.date}`);
  store.save();
  return e;
}

async function runAction(contractNo, serial, action, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  const step = STEPS.find(s => s.action === action);
  if (!step) throw new BancsError(30400, `Unknown action ${action}.`, 400);
  if (e.status !== S.DRAFT) {
    throw new BancsError(30406, `${step.label} cannot be performed. The endorsement quote is in ${e.status} status.`);
  }
  if (!step.from.includes(e.stage)) {
    const ORDER = ['started', 'layer', 'premium', 'subEnded', 'locked', 'finalised'];
    const next = STEPS.find(x => x.from.includes(e.stage) && ORDER.indexOf(x.to) > ORDER.indexOf(e.stage));   // the forward step, not a repeat
    const nextText = next ? ` The next step is ${next.label}.` : '';
    // A repeated click (double click, or Back then click again) is not an out-of-order step.
    if (ORDER.indexOf(e.stage) >= ORDER.indexOf(step.to)) {
      throw new BancsError(30410, `${step.label} has already been performed for this endorsement (Sub Status: ${e.subStatus}).${nextText}`);
    }
    const [code, msg] = STEP_ERRORS[action];
    throw new BancsError(code, msg + nextText);
  }
  if (action === 'finalise' && (!e.acceptance || e.acceptance.accepted !== 'Yes')) {
    throw new BancsError(30407, 'Finalise Endorsement cannot be performed. Contracting party acceptance has not been captured.');
  }
  if (action === 'finalise' && e.types.includes(IMED_TYPE) && !e.adviserChange) {
    throw new BancsError(30412, 'Finalise Endorsement cannot be performed. No new adviser has been added on Requestor Advisor Info for this Change Primary IMED endorsement.');
  }
  if (action === 'finalise' && Object.keys(e.sharingDraft || {}).length) {
    throw new BancsError(30408, 'Finalise Endorsement cannot be performed. Advisor Change has sharing changes that have not been saved. Click Save on the Advisor Change screen.');
  }
  // A fee saved after Calculate Premium leaves the summary out of date; it has to be calculated again.
  if (action === 'end-sub-endorsement' && e.calc && e.calc.stale) {
    throw new BancsError(30411, 'End Sub Endorsement cannot be performed. The VAT Inclusive Asset Advice Fee was changed after Calculate Premium, so the premium is out of date. Click Calculate Premium again.');
  }
  // Checked while the fee can still be corrected: Basic Details locks once the sub endorsement ends.
  if (action === 'calculate-premium' || action === 'end-sub-endorsement') {
    const x = expectedSplitFee(e);
    const actual = e.pendingFee ? e.pendingFee.vatInclusive : fee(e.contractNo).vatInclusive;
    if (x && Math.abs(actual - x.expected) > 0.001) {
      throw new BancsError(30409, `${step.label} cannot be performed. The remaining adviser keeps ${x.share.toFixed(2)}% of the asset advice fee, so VAT Inclusive Asset Advice Fee must be ${x.expected.toFixed(3)} (${x.base.toFixed(3)} x ${x.share.toFixed(2)}%), but it is ${Number(actual).toFixed(3)}. Update it on Basic Details.`);
    }
  }
  e.stage = step.to;
  e.subStatus = SUB[step.to];
  if (action === 'calculate-premium') {
    // The Endr Quote Summary figures: fee refund or collection, adviser commission and clawback, EAC (see calc.js).
    const feeNow = fee(contractNo).vatInclusive;
    e.calc = calc.compute({
      policy: policy(contractNo), feeBefore: feeNow,
      feeAfter: e.pendingFee ? e.pendingFee.vatInclusive : feeNow, effectiveDate: e.effectiveDate
    });
    e.calc.calculatedAt = new Date().toISOString();
  }
  if (action === 'finalise') e.status = S.FINAL;
  log(e, u.id, action);
  store.save();
  return e;
}

const SUBMISSION_FIELDS = [
  'reinsuranceVerified', 'sarInProgress', 'uwRequirementsOutstanding', 'allAdminRequirementsReceived',
  'uwMlqCompleteDate', 'uwAllReqmtRecvdDate', 'spousalConsentCaptured',
  'adminRequirementsOutstanding', 'applicationSubStatus', 'uwNewReqmtDate', 'legalVerification'
];

// "All Contracting Parties have accepted the application" is read-only: it mirrors the Acceptance screen.
const acceptedValue = e => (e.acceptance && e.acceptance.accepted === 'Yes' ? 'Yes' : e.acceptance && e.acceptance.accepted === 'No' ? 'No' : '');

function submissionOf(e) {
  if (e.submission) return { ...e.submission, allPartiesAccepted: acceptedValue(e) };
  const p = policy(e.contractNo);
  return {
    reinsuranceVerified: 'No', sarInProgress: '', uwRequirementsOutstanding: '', allAdminRequirementsReceived: 'Yes',
    uwMlqCompleteDate: '', uwAllReqmtRecvdDate: '', spousalConsentCaptured: 'No',
    allPartiesAccepted: acceptedValue(e),
    adminRequirementsOutstanding: '', applicationSubStatus: '', uwNewReqmtDate: '',
    legalVerification: p.submissionDefaults.legalVerification,
    applicationSubmissionDate: cfg().systemDate, effectiveDate: e.effectiveDate, basisDate: ''
  };
}

function applySubmissionFields(e, body) {
  const sub = { ...submissionOf(e) };
  for (const f of SUBMISSION_FIELDS) if (f in body) sub[f] = String(body[f] ?? '');
  e.submission = sub;
  return sub;
}

function saveSubmission(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  if (e.status !== S.DRAFT && e.stage !== 'finalised') {
    throw new BancsError(48100, 'Endr Quote Submission can only be saved while the endorsement is open, before it is submitted.');
  }
  applySubmissionFields(e, body);
  log(e, u.id, 'submission saved');
  store.save();
  return e;
}

async function submit(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  if (e.stage !== 'finalised') {
    throw new BancsError(48101, 'Endorsement quote cannot be submitted. Finalise Endorsement has not been completed or the quote is already submitted.');
  }
  const sub = applySubmissionFields(e, body);
  const problems = [];
  if (sub.adminRequirementsOutstanding) problems.push('Admin Requirements Outstanding must be blank');
  if (sub.uwRequirementsOutstanding) problems.push('Underwriting Requirements Outstanding must be blank');
  if (sub.allAdminRequirementsReceived !== 'Accepted') problems.push('All admin requirements received must be Accepted');
  if (sub.reinsuranceVerified !== 'Yes') problems.push('Reinsurance Verified must be Yes');
  if (sub.legalVerification !== 'Approved') problems.push('Legal Verification must be Approved');
  if (problems.length) {
    store.save();
    throw new BancsError(48120, `Endorsement quote cannot be submitted. ${problems.join('; ')}.`);
  }
  e.stage = 'submitted';
  e.subStatus = SUB.submitted;
  e.submittedBy = u.id;
  if (!isClosed(contractNo)) mail.notify('verify', e);
  log(e, u.id, 'submit');
  store.save();
  return e;
}

const isClosed = contractNo => policy(contractNo).book === 'closed';

// Maker-checker: the submitter cannot activate their own endorsement. The closed book has no second person
// ("you don't have to get the second person", recording 55:00), so there the same user may activate.
async function activate(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  if (e.stage !== 'submitted') {
    throw new BancsError(71020, 'Endorsement quote cannot be activated. It has not been submitted.');
  }
  const closed = isClosed(contractNo);
  if (!closed && e.submittedBy === u.id) {
    throw new BancsError(71035, 'Segregation of duties violation. The endorsement quote cannot be activated by the user who submitted it. Please refer to a different authorised user.', 403);
  }
  if (!closed && u.role !== 'PREM-ADM') {
    throw new BancsError(71036, `Role ${u.role} is not authorised to activate endorsement quotes.`, 403);
  }
  e.stage = 'approved';
  e.subStatus = SUB.approved;
  e.activatedBy = u.id;
  if (!closed) mail.notify('approved', e);
  if (e.adviserChange) {
    const db = store.get(), c = e.adviserChange;
    const i = db.advisers.findIndex(a => a.contractNo === contractNo && a.id === c.replaces);
    if (i >= 0) {
      const old = db.advisers[i];
      db.advisers[i] = {
        id: old.id, contractNo, partyCode: c.add.partyCode, salesCode: c.add.salesCode, name: c.add.name,
        type: c.add.type, segment: old.segment, distributionChannel: c.add.distributionChannel, primary: c.add.primary, share: old.share
      };
      if (c.add.primary) Object.assign(policy(contractNo).basic, { salesCode: c.add.salesCode, adviserPartyCode: c.add.partyCode, distributionChannel: c.add.distributionChannel });
    }
  }
  if (e.pendingFee) {
    const f = fee(contractNo);
    f.vatInclusive = e.pendingFee.vatInclusive;
    f.vatExclusive = e.pendingFee.vatExclusive;
    f.effectiveDate = e.pendingFee.effectiveDate;
  }
  if (e.pendingBasic) Object.assign(policy(contractNo).basic, e.pendingBasic);
  if (e.sharing && e.sharing.contribution) {
    const master = advisersMaster();
    const db = store.get();
    db.advisers = db.advisers.filter(a => a.contractNo !== contractNo);
    e.sharing.contribution.forEach((r, i) => {
      const m = master.find(x => x.partyCode === r.advisor);
      db.advisers.push({
        id: `${contractNo}-A${i + 1}`, contractNo, partyCode: m.partyCode, salesCode: m.salesCode, name: m.name,
        type: m.type, segment: m.segment, distributionChannel: m.distributionChannel,
        primary: r.primary === 'Yes', share: Number(r.v[0])
      });
    });
  }
  log(e, u.id, 'activate');
  store.save();
  return e;
}

function reject(contractNo, serial, body) {
  const u = user(body.user);
  const e = endorsement(contractNo, serial);
  if (![S.DRAFT, S.FINAL].includes(e.status) || e.stage === 'approved') {
    throw new BancsError(71040, 'Only an open endorsement quote can be rejected.');
  }
  e.status = S.REJECTED;
  e.subStatus = '';
  e.stage = 'rejected';
  log(e, u.id, 'reject');
  store.save();
  return e;
}

module.exports = {
  BancsError, S, SUB, STEPS, SUBMISSION_FIELDS,
  user, policy, endorsementsOf, endorsement, fee, blocking, submissionOf,
  checkCanEndorse, createEndorsement, updateFee, saveAcceptance, runAction,
  saveSubmission, submit, activate, reject,
  stageAdviserChange, clearAdviserChange, IMED_TYPE, SALES_CODE_TYPES, DISTRIBUTION_CHANNELS, ADVISOR_TYPES,
  SHARING, advisersMaster, stageSharing, commitSharing, requesterParties, expectedSplitFee, AMEND_POT_REASONS
};
