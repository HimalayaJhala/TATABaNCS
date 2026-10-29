// The Endr Quote Summary calculations, worked out the way a life and investment administrator would for a
// fee-change endorsement on a LISP / tax-free policy. Pure functions: no state, no I/O, so the Excel
// workbook (scripts/build-calcsheet.js) reproduces every figure with live formulas and the two are compared.
//
// The model, in the order BaNCS presents it:
//
//  1. FEE. The asset advice fee is a percentage a year of the market value, collected monthly on the policy's
//     due date. VAT Exclusive = VAT Inclusive / 1.15.
//        annual fee   = ROUND(market value x fee % / 100, 2)
//        monthly fee  = ROUND(annual fee / 12, 2)
//
//  2. FEE PERIOD. Only the fee period the endorsement lands in is adjusted; later periods simply use the new fee.
//        period       = previous due date (next due date less one month) to next due date
//        days         = next due - previous due
//        remaining    = MAX(0, MIN(days, next due - effective date))
//
//  3. REFUND OR COLLECTION. The difference in the monthly fee, for the days left in the period.
//        difference   = old monthly - new monthly
//        refund       = ROUND(difference x remaining / days, 2)     when the fee falls (credited back to the client)
//        collection   = ROUND(-difference x remaining / days, 2)    when the fee rises (collected from the client)
//
//  4. COMMISSION. The adviser is paid the VAT-exclusive fee (as-and-when, so nothing is paid on contributions).
//        ongoing %    = new VAT-exclusive fee x commission scaling %
//        clawback     = ROUND(refund / 1.15 x scaling %, 2)         adviser commission reversed on the refund
//        commission   = ROUND(new monthly / 1.15 x remaining / days x scaling %, 2)   commission for the rest of the period
//
//  5. EAC (effective annual cost, ASISA style). For each milestone the monthly contributions are projected at the
//     fund's gross growth with and without charges; EAC is the gap between the two annualised returns (IRR).
//     Charges: investment (fund TER), advice (VAT-inclusive asset advice fee after the endorsement), admin (the
//     platform charge plus the initial charge on each contribution). Charges interact slightly, so each
//     component is measured alone and scaled so the components add up to the total.
//
// Everything is rounded the way Excel rounds: half away from zero, with a 1E-9 guard against binary noise.

const VAT = 1.15;

// Assumptions the sheet shows and Old Mutual can overwrite. The initial charge is policy A's own 1.725%
// (R10.35 off R600.00, as in the recording); the others are typical for the products.
const ASSUMPTIONS = {
  investmentCharge: { OMSLISPI: 0.85, OMSTFII: 0.70 },   // fund total expense ratio, % a year
  adminCharge: 0.35,                                      // platform administration, % a year
  contributionCharge: 1.725,                              // initial charge, % of each contribution
  otherCharge: 0                                          // nothing else is charged on these products
};

const GUARD = 1e-9;
const excelRound = (v, d) => { const k = 10 ** d; const r = Math.sign(v) * Math.round(Math.abs(v) * k) / k; return r === 0 ? 0 : r; };
const rnd = (x, d) => excelRound(x + GUARD, d);

// ---- dates, DD/MM/YYYY ----
const parse = s => { const [d, m, y] = String(s).split('/').map(Number); return { d, m, y }; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const serial = s => { const { d, m, y } = parse(s); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const pad = n => String(n).padStart(2, '0');
function addMonths(s, n) {                                // clamps the day, like Excel's EDATE
  const { d, m, y } = parse(s);
  const t = (y * 12 + (m - 1)) + n, ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return `${pad(Math.min(d, daysIn(ny, nm)))}/${pad(nm)}/${ny}`;
}

// ---- the EAC machinery (Excel: FV and RATE with annuity-due) ----
const fvDue = (i, n, pmt) => (i === 0 ? pmt * n : pmt * (((1 + i) ** n - 1) / i) * (1 + i));
function rateDue(n, pmt, fv) {                             // the monthly rate r with fvDue(r, n, pmt) = fv
  let lo = -0.5, hi = 1;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (fvDue(mid, n, pmt) < fv) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// One scenario: charges of q % a year growth reduction and an initial charge of u % on each contribution.
// Returns the steps the workbook shows: net growth, final value, annualised IRR, and the EAC (percentage points).
function scenarioParts(g, q, u, c, n) {
  const gn = g - q / 100;
  const ni = (1 + gn) ** (1 / 12) - 1;
  const fv = c * (1 - u / 100) * fvDue(ni, n, 1);
  const r = rateDue(n, c, fv);
  const irr = (1 + r) ** 12 - 1;
  return { gn, fv, irr, eac: (g - irr) * 100 };
}
const eacOf = (g, q, u, c, n) => scenarioParts(g, q, u, c, n).eac;
const milestoneYears = termMonths => { const t = Math.round(termMonths / 12); return t > 10 ? [1, 5, 10, t] : [1, 3, 5, t]; };

function eac(policy, adviceFeeIncl) {
  const g = Number(policy.basic.grossYield) / 100;
  const c = Number(policy.contribution.amount);
  const ter = ASSUMPTIONS.investmentCharge[policy.productCode] ?? 0.85;
  const adm = ASSUMPTIONS.adminCharge, u = ASSUMPTIONS.contributionCharge, adv = adviceFeeIncl;
  const years = milestoneYears(Number(policy.basic.investmentTermMonths));
  const rows = { Investment: [], Advice: [], Admin: [], Other: [], EAC: [] };
  const detail = years.map(y => {
    const n = y * 12;
    const total = eacOf(g, ter + adm + adv + ASSUMPTIONS.otherCharge, u, c, n);
    const sInv = eacOf(g, ter, 0, c, n), sAdv = eacOf(g, adv, 0, c, n), sAdm = eacOf(g, adm, u, c, n);
    const sum = sInv + sAdv + sAdm;
    const part = s => (sum === 0 ? 0 : rnd(s * total / sum, 2));
    const inv = part(sInv), advr = part(sAdv), admr = part(sAdm);
    rows.Investment.push(inv); rows.Advice.push(advr); rows.Admin.push(admr); rows.Other.push(0);
    rows.EAC.push(rnd(inv + advr + admr, 2));
    return { years: y, months: n, total, sInv, sAdv, sAdm };
  });
  return { years, rows, detail };
}

// ---- the whole Endr Quote Summary ----
// policy: the policy record; feeBefore / feeAfter: VAT-inclusive asset advice fee (%) now and after the
// endorsement; effectiveDate: DD/MM/YYYY.
function compute({ policy, feeBefore, feeAfter, effectiveDate }) {
  const mv = Number(policy.basic.marketValue);
  const scaling = Number(policy.commission.scalingPct) / 100;

  const annualBefore = rnd(mv * feeBefore / 100, 2), annualAfter = rnd(mv * feeAfter / 100, 2);
  const monthlyBefore = rnd(annualBefore / 12, 2), monthlyAfter = rnd(annualAfter / 12, 2);

  const nextDue = policy.basic.nextDueDate, prevDue = addMonths(nextDue, -1);
  const days = serial(nextDue) - serial(prevDue);
  const remaining = Math.max(0, Math.min(days, serial(nextDue) - serial(effectiveDate)));

  const diff = rnd(monthlyBefore - monthlyAfter, 2);
  const refund = diff > 0 ? rnd(diff * remaining / days, 2) : 0;
  const collection = diff < 0 ? rnd(-diff * remaining / days, 2) : 0;
  const clawback = rnd(refund / VAT * scaling, 2);
  const commission = rnd(monthlyAfter / VAT * remaining / days * scaling, 2);

  return {
    marketValue: mv, feeBefore, feeAfter,
    feeExclBefore: rnd(feeBefore / VAT, 3), feeExclAfter: rnd(feeAfter / VAT, 3),
    annualBefore, annualAfter, monthlyBefore, monthlyAfter, difference: diff,
    period: { previousDue: prevDue, nextDue, days, remaining },
    premium: Number(policy.contribution.amount),
    refund, collection, clawback, commission,
    commissionSummary: {
      immediatePct: 0,
      ongoingPct: rnd(feeAfter / VAT * scaling, 3),
      primaryUpfront: 0, secondaryUpfront: 0, eachPremium: 0,
      immediately: rnd(-clawback, 2),
      scalingPct: Number(policy.commission.scalingPct), distributionFeeScalingPct: Number(policy.commission.distributionFeeScalingPct)
    },
    cgt: 0, mva: 0, reductionFee: 0, transactionAdminFee: 0,
    eac: eac(policy, feeAfter),
    effectiveDate, stale: false
  };
}

module.exports = { VAT, ASSUMPTIONS, compute, eac, rnd, addMonths, serial, milestoneYears, eacOf, scenarioParts, fvDue, rateDue };
