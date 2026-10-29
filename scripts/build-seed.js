// Generates data-service/seed/seed.json. Run with `npm run seed`; the output is committed and never
// mutated at runtime. Person-identifying values are fictional. Structure, codes, amounts and statuses
// follow the SOP screenshots and the 4 August 2026 recording.
//
// How the numbers are derived (so the data hangs together):
//  - Fees are entered ex-VAT (typical advice fees are 0.30% to 1.50% p.a.) and stored VAT-inclusive
//    (x 1.15); VAT-exclusive is always inclusive / 1.15 again, exactly as BaNCS shows it.
//  - "Amount deducted from each regular contribution" is 1.725% of the contribution (policy A:
//    R600.00 -> 10.35, as in the recording).
//  - Market Value grows with the contributions paid to the system date (04/08/2026).
//  - TFI II contributions stay within the R3,000 a month tax-free limit.
const fs = require('fs');
const path = require('path');

const SYSTEM_DATE = '04/08/2026';
const VAT = 1.15;

// South African ID: YYMMDD SSSS C A Z, Z is a Luhn check digit.
function saId(dob, gender, seq) {
  const [d, m, y] = dob.split('/');
  const s = (gender === 'F' ? 0 : 5000) + (seq % 5000);          // SSSS: 0000-4999 female, 5000-9999 male
  const body = y.slice(2) + m + d + String(s).padStart(4, '0') + '0' + '8';
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let n = Number(body[i]);
    if ((12 - i) % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return body + ((10 - (sum % 10)) % 10);
}

const PRODUCTS = {
  LISP: { productName: 'OMS LISP Investment', productCode: 'OMSLISPI', productShort: 'LISPI', benefit: 'LISP Investment Benefit', wrapper: 'LI', taxClass: 'CRT' },
  TFI: { productName: 'OMS TFI II', productCode: 'OMSTFII', productShort: 'TFII', benefit: 'TFI Investment Benefit', wrapper: 'TF', taxClass: 'TFI' }
};

// One party code per adviser, the same on every policy.
const ADVISERS = {
  '699001': { party: 'BNCSMD-100199001', name: 'THELMA RIKHOTSO', channel: 'Personal Finance Advice SA' },
  '694653': { party: 'BNCSMD-100194653', name: 'SANDILE MKHIZE', channel: 'Personal Finance Advice SA' },
  '695445': { party: 'BNCSMD-100195445', name: 'JOHAN VAN DER MERWE', channel: 'Personal Finance Advice SA' },
  '657110': { party: 'BNCSMD-100157110', name: 'ANNELIE DU TOIT', channel: 'Broker Distribution' },
  '631710': { party: 'BNCSMD-100131710', name: 'RAJESH GOVENDER', channel: 'Broker Distribution' },
  '631631': { party: 'BNCSMD-100131631', name: 'LINDA NKOSI', channel: 'Broker Distribution' },
  '630174': { party: 'BNCSMD-100130174', name: 'MARK JACOBS', channel: 'Broker Distribution' },
  '632013': { party: 'BNCSMD-100132013', name: 'PRIYA NAIR', channel: 'Broker Distribution' },
  '631819': { party: 'BNCSMD-100131819', name: 'LERATO MOKGOSI', channel: 'Broker Distribution' },
  '688412': { party: 'BNCSMD-100188412', name: 'THEMBA SIBIYA', channel: 'Broker Distribution' },
  '642907': { party: 'BNCSMD-100142907', name: 'KAREN BOTES', channel: 'Broker Distribution' },
  '615538': { party: 'BNCSMD-100115538', name: 'YUSUF EBRAHIM', channel: 'Broker Distribution' }
};

// contract, product, first, middle, last, gender, dob, advice fee ex-VAT %, scenario,
// advisers [[salesCode, share]], contribution, term (months), total commission (work list), start date, history?
const ROWS = [
  // ---- single adviser, non-zero fee: the happy path --------------------------------------------
  ['119900001001', 'LISP', 'NOKUTHULA', 'JANE', 'MAHLOBO', 'F', '14/09/1986', 0.50, 'happy', [['699001', 100]], 600, 240, 12.48, '30/01/2026', false],
  ['110671307001', 'TFI', 'SIPHO', 'ANDILE', 'KHUMALO', 'M', '14/03/1979', 1.00, 'happy', [['694653', 100]], 2500, 240, 100.69, '12/02/2024', false],
  ['112333103001', 'LISP', 'THANDEKA', 'GRACE', 'ZULU', 'F', '22/11/1990', 0.75, 'happy', [['657110', 100]], 1200, 180, 41.07, '03/05/2024', false],
  ['112953094001', 'TFI', 'RIAAN', 'PIETER', 'STEYN', 'M', '02/07/1972', 0.50, 'happy', [['631710', 100]], 3000, 240, 0.19, '18/09/2024', false],
  ['113162231001', 'LISP', 'AYESHA', 'FATIMA', 'PATEL', 'F', '19/09/1988', 1.25, 'happy', [['631631', 100]], 4500, 300, 7.62, '07/01/2025', true],
  ['113165622001', 'LISP', 'KAGISO', 'THABO', 'MOLEFE', 'M', '05/05/1983', 1.00, 'happy', [['630174', 100]], 1500, 180, 63.35, '09/01/2025', false],
  ['113402518001', 'TFI', 'CHARLENE', 'ANNE', 'ADAMS', 'F', '27/01/1994', 0.60, 'happy', [['694653', 100]], 1000, 240, 2.91, '21/03/2025', false],
  ['113577840001', 'LISP', 'BONGANI', 'LUCAS', 'MAHLANGU', 'M', '11/12/1976', 0.90, 'happy', [['657110', 100]], 2000, 180, 19.54, '02/06/2025', true],
  ['111890254001', 'LISP', 'FATIMA', 'ZAINAB', 'OSMAN', 'F', '30/08/1981', 0.40, 'happy', [['632013', 100]], 2800, 240, 4.12, '14/11/2022', true],
  ['112045877001', 'TFI', 'ITUMELENG', 'JOSEPH', 'SELLO', 'M', '17/02/1987', 0.80, 'happy', [['695445', 100]], 1800, 300, 9.89, '06/02/2023', false],
  ['112476310001', 'LISP', 'CHANTEL', 'MARIE', 'VAN WYK', 'F', '04/04/1975', 1.50, 'happy', [['631819', 100]], 3500, 180, 6.92, '27/09/2023', true],
  ['112718459001', 'TFI', 'MPHO', 'BLESSING', 'DLAMINI', 'M', '21/12/1996', 0.30, 'happy', [['699001', 100]], 600, 360, 1.44, '15/01/2024', false],
  ['113084721001', 'LISP', 'NOMVULA', 'SIPHOKAZI', 'TSHABALALA', 'F', '09/03/1969', 0.70, 'happy', [['694653', 100]], 5000, 120, 45.28, '19/08/2024', true],
  ['113290536001', 'LISP', 'DEON', 'HENDRIK', 'BEKKER', 'M', '13/10/1980', 1.10, 'happy', [['630174', 100]], 2200, 240, 2.54, '22/02/2025', false],
  // ---- fee already 0.000: the skip rule -------------------------------------------------------
  ['113690412001', 'LISP', 'NALEDI', 'PRECIOUS', 'MOKOENA', 'F', '30/04/1987', 0, 'zero-fee', [['631710', 100]], 1400, 240, 0.84, '14/07/2025', false],
  ['113712955001', 'TFI', 'WERNER', 'JOHAN', 'COETZEE', 'M', '16/08/1969', 0, 'zero-fee', [['631631', 100]], 2100, 240, 5.3, '28/07/2025', false],
  ['113845106001', 'LISP', 'ZANELE', 'RUTH', 'DUBE', 'F', '09/02/1992', 0, 'zero-fee', [['630174', 100]], 3200, 300, 88.12, '19/08/2025', false],
  // ---- error 56000: a transaction is already in progress --------------------------------------
  ['113901377001', 'LISP', 'LUNGILE', 'PETER', 'NGCOBO', 'M', '23/06/1981', 0.50, 'future-endorsement', [['699001', 100]], 1700, 240, 33.6, '01/09/2025', false],
  ['114020658001', 'TFI', 'MEGAN', 'LOUISE', 'FOURIE', 'F', '03/10/1985', 1.00, 'open-endorsement', [['694653', 100]], 1250, 240, 1.45, '15/10/2025', false],
  // ---- ID number differs from the work list ---------------------------------------------------
  ['114137290001', 'LISP', 'TSHEPO', 'DANIEL', 'MASEKO', 'M', '28/02/1980', 1.00, 'id-mismatch', [['657110', 100]], 2600, 240, 54.27, '03/11/2025', false],
  // ---- Legal Verification defaults blank ------------------------------------------------------
  ['114250817001', 'LISP', 'NOMPUMELELO', 'JOY', 'SHABALALA', 'F', '12/07/1991', 0.50, 'legal-blank', [['631710', 100]], 900, 240, 9.96, '24/11/2025', false],
  ['114318964001', 'TFI', 'GARETH', 'MICHAEL', 'NAIDOO', 'M', '07/04/1975', 1.00, 'legal-blank', [['631631', 100]], 2750, 240, 71.38, '08/12/2025', false],
  // ---- split commission -----------------------------------------------------------------------
  ['114561023001', 'LISP', 'BUSISIWE', 'FAITH', 'MTHEMBU', 'F', '15/01/1984', 1.00, 'split', [['630174', 60], ['688412', 40]], 3000, 240, 26.4, '13/01/2026', false],
  ['114602745001', 'TFI', 'ANDRE', 'FRANCOIS', 'DU PLESSIS', 'M', '21/09/1970', 1.00, 'split', [['694653', 50], ['642907', 50]], 2000, 240, 48.9, '20/01/2026', false],
  ['114688139001', 'LISP', 'PALESA', 'LERATO', 'RADEBE', 'F', '04/12/1989', 0.50, 'split', [['657110', 50], ['615538', 30], ['688412', 20]], 1800, 240, 15.75, '27/01/2026', false],
  ['114723506001', 'LISP', 'RUBEN', 'KYLE', 'PILLAY', 'M', '18/05/1986', 1.00, 'split', [['631710', 80], ['642907', 20]], 2400, 240, 3.12, '29/01/2026', false]
];

const HISTORY_TYPES = ['Update Contracting Party Details', 'Change Payment Method', 'Change Correspondent', 'Change Payer Bank Account or Payroll Details'];

// ---- date helpers (DD/MM/YYYY) ----
const pad = n => String(n).padStart(2, '0');
const parse = d => { const [dd, mm, yy] = d.split('/').map(Number); return new Date(yy, mm - 1, dd); };
const fmt = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const toKey = d => d.split('/').reverse().join('');
const addMonths = (d, n) => { const x = parse(d); x.setMonth(x.getMonth() + n); return fmt(x); };
const monthsBetween = (a, b) => { const x = parse(a), y = parse(b); return (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth(); };
const nextAnniv = start => { let d = addMonths(start, 12); while (toKey(d) <= toKey(SYSTEM_DATE)) d = addMonths(d, 12); return d; };
const nextDue = start => {
  const day = Math.min(parse(start).getDate(), 30);
  let d = parse(`${pad(day)}/08/2026`);
  if (d <= parse(SYSTEM_DATE)) d = parse(`${pad(day)}/09/2026`);
  return fmt(d);
};
const r3 = n => Math.round(n * 1000 + 1e-9) / 1000;
const r2 = n => Math.round(n * 100) / 100;
const money = n => r2(n).toFixed(2);
const declDates = ['04/08/2026', '01/08/2026', '31/07/2026', '03/08/2026', '30/07/2026'];
const partyChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

function historic(contractNo, serial, type, effective, status = 'FINAL ENDORSEMENT QUOTE', subStatus = 'Approved Endorsed Quote') {
  return {
    id: `${contractNo}-${serial}`, contractNo, serial,
    quotationNumber: `${contractNo}${String(serial).padStart(4, '0')}`,
    types: [type], effectiveDate: effective, quoteDate: effective, status, subStatus,
    stage: status === 'DRAFT ENDORSEMENT QUOTE' ? 'started' : status === 'REJECTED ENDORSEMENT QUOTE' ? 'rejected' : 'approved',
    coolingOffApplicable: 'No', coolOffFlag: 'No',
    capturedBy: 'hist.user', submittedBy: status === 'DRAFT ENDORSEMENT QUOTE' ? null : 'hist.user',
    activatedBy: status === 'FINAL ENDORSEMENT QUOTE' ? 'hist.verifier' : null,
    instanceNumber: '99999', bizagiCaseId: 'NA', carmaKey: 'NA', requesterStakeCode: 'Contract Owner',
    pendingFee: null, acceptance: null, submission: null, log: []
  };
}

const policies = [], fees = [], advisers = [], endorsements = [], worklist = [];

ROWS.forEach((r, i) => {
  const [contractNo, prod, first, middle, last, gender, dob, exFee, scenario, advs, contribution, term, totalComm, startDate, hasHistory] = r;
  const p = PRODUCTS[prod];
  const isA = contractNo === '119900001001';
  const idNumber = saId(dob, gender, 4417 + i * 389);
  let partyCode = 'BNCSGC-';
  for (let k = 0; k < 13; k++) partyCode += partyChars[(i * 31 + k * 17 + k * k) % partyChars.length];
  if (isA) partyCode = 'BNCSGC-SYNTH00000001';
  const lead = ADVISERS[advs[0][0]];

  // Market value: contributions paid to the system date, plus a modest growth that builds with time.
  const months = Math.max(1, monthsBetween(startDate, SYSTEM_DATE));
  const marketValue = contribution * months * (1 + 0.0042 * months);
  const gross = 8.6 + (i % 6) * 0.45;

  policies.push({
    contractNo,
    quotationNumber: isA ? '119900001/Q000025731666' : `${contractNo.slice(0, 9)}/Q0000${25731666 - i * 48211}`,
    ...p,
    status: 'ACTIVE POLICY',
    subStatus: 'Active',
    startDate,
    expiryDate: '',
    currency: 'South African Rand',
    branch: 'HO',
    coverAmount: money(contribution * 12),
    scenario,
    owner: {
      partyCode, title: gender === 'F' ? 'MS' : 'MR', firstName: first, middleName: middle, lastName: last,
      initials: first[0] + middle[0], dob, idNumber, gender, nature: 'Individual', identityType: 'RSA ID'
    },
    basic: {
      quoteInstanceNumber: contractNo.slice(0, 9),
      waiverNumber: '',
      distributionChannel: lead.channel,
      segment: contribution >= 3500 ? 'Wealth' : 'Personal Finance SA',
      salesCode: advs[0][0],
      salesCodeType: '0',
      adviserPartyCode: lead.party,
      brokerExternalReference: '',
      quoteDate: startDate,
      quoteExpiryDate: '03/09/2026',
      applicationDate: startDate,
      policyStartDate: startDate,
      nextPolicyAnniversaryDate: nextAnniv(startDate),
      nextDueDate: nextDue(startDate),
      firstContributionDueDate: startDate,
      legalStructure: 'Natural Person',
      minor: 'No',
      savingsNeed: 'General Savings',
      noDealings: 'No', amendPotReason: '', removeReason: '',
      planType: prod === 'LISP' ? 'Voluntary' : 'Tax Free',
      personalisedInvestmentName: 'Savings',
      amountDeductedEachRegularContribution: isA ? '10.35' : money(contribution * 0.01725),
      amountDeductedFromContractValue: '0.00',
      amountDeductedFirstRegularContribution: '0.00',
      amountDeductedLumpSum: '0.00',
      investmentTermMonths: String(term),
      marketValue: money(marketValue),
      maturityDate: addMonths(startDate, term),
      grossYield: gross.toFixed(2),
      netYield: (gross - exFee * VAT - 0.35).toFixed(2),
      vestedPercentage: '67.00',
      nonVestedPercentage: '33.41',
      transactionAdminFeeScaling: '100.00',
      reductionFeeScaling: '100.00',
      mvaFeeScaling: '100.00'
    },
    contribution: {
      type: 'Regular', amount: money(contribution), reference: `RG${275419900 + i * 7311}${startDate.replace(/\//g, '')}`,
      startDate, ceaseDate: addMonths(startDate, term), method: 'Bank deduction', increase: 'Inflation-linked'
    },
    commission: {
      benefitName: p.benefit, type: 'As and when - Full Term', immediatePct: '0.00', ongoingPct: '0.00',
      primaryUpfront: '0.00', secondaryUpfront: '0.00', eachPremium: '0.00', immediately: '0.00',
      scalingPct: '100.00', distributionFeeScalingPct: '0.00'
    },
    // The SOP: "Legal Verification, if not pre-populated then select the Approved option". 112333103001 is the dummy
    // work list row that opens with it blank, so a run meets that branch.
    submissionDefaults: { legalVerification: scenario === 'legal-blank' || contractNo === '112333103001' ? '' : 'Approved' }
  });

  // Stored VAT-inclusive; VAT-exclusive derived from it, so the pair is always consistent.
  const incl = r3(exFee * VAT);
  fees.push({ contractNo, vatInclusive: incl, vatExclusive: r3(incl / VAT), effectiveDate: startDate });

  advs.forEach(([sales, share], k) => {
    const a = ADVISERS[sales];
    advisers.push({
      id: `${contractNo}-A${k + 1}`, contractNo, partyCode: a.party, salesCode: sales, name: a.name,
      type: 'Broker', segment: 'Personal Finance SA', distributionChannel: a.channel, primary: k === 0, share
    });
  });

  // Excel work list row (S&I sheet). The id-mismatch row carries a different, still valid, ID number.
  const listId = scenario === 'id-mismatch' ? saId(dob, gender, 4417 + i * 389 + 9) : idNumber;
  worklist.push({
    assigned: '', approver: '', contractNumber: contractNo,
    bancsProductCode: p.productCode, productCode: p.productShort, intermediaryCode: advs[0][0],
    productInstance: 0, commShare: advs.length > 1 ? advs[0][1] : 100, totalCommission: totalComm,
    idNumber: listId, declarationSignedDate: declDates[i % declDates.length]
  });

  // A lived-in policy has history: one earlier, already approved endorsement.
  if (hasHistory) {
    const eff = addMonths(startDate, 6 + (i % 7));
    endorsements.push(historic(contractNo, 1, HISTORY_TYPES[i % HISTORY_TYPES.length], toKey(eff) < toKey('01/07/2026') ? eff : '15/05/2026'));
  }
});

// The contracts on the dummy work list (119900001001, 102790002001, 110671307001, 112333103001) start with no
// endorsement quotes, so Endorsement Quotes only ever shows what a run created.
endorsements.push(
  // 56000 scenarios: a finalised endorsement effective 01/11/2026, and an open draft
  historic('113901377001', 1, 'Change Premium Collection Day', '01/11/2026'),
  historic('114020658001', 1, 'Update Contribution Details', '04/08/2026', 'DRAFT ENDORSEMENT QUOTE', 'Sub-Endorsement Started')
);

// ---- Relationship Transition List (PUF and CUF): move a policy from one adviser to another -----------
// The 4 August 2026 recording, from 38:00. The list only gives policy numbers, so a case can be in the open
// book (this BaNCS) or the closed book (a second BaNCS with its own link and login, contract numbers like
// 13393025/LSD/1, one per benefit). Each row below is one of the edge cases shown there.
const TRANSITION_PRODUCTS = {
  OMPL: { productName: 'OMP Life', productCode: 'OMPLIFE', productShort: 'OMPL', benefit: 'Life Cover Benefit', wrapper: 'RK', taxClass: 'IND' },
  OMPFL: { productName: 'OMP Future Life', productCode: 'OMPFLIFE', productShort: 'OMPFL', benefit: 'Life Cover Benefit', wrapper: 'RK', taxClass: 'IND' },
  GLD: { productName: 'GL Death', productCode: 'GLDEATH', productShort: 'GLD', benefit: 'Group Life Death Benefit', wrapper: 'GL', taxClass: 'GRP' },
  GLFE: { productName: 'GL Final Expenses', productCode: 'GLFINEXP', productShort: 'GLFE', benefit: 'Final Expenses Benefit', wrapper: 'GL', taxClass: 'GRP' }
};
// The two advisers on the list (from and to), and two more that share the closed-book policies.
Object.assign(ADVISERS, {
  '610901': { party: 'BNCSMD-100110901', name: 'KHANYISILE MOKOENA', channel: 'Personal Finance Advice SA' },
  '620455': { party: 'BNCSMD-100120455', name: 'PRAVEEN NAIDOO', channel: 'Personal Finance Advice SA' },
  '633310': { party: 'BNCSMD-100133310', name: 'HENDRIK BOSHOFF', channel: 'Broker Distribution' },
  '600122': { party: 'BNCSMD-100100122', name: 'ZINHLE NDLOVU', channel: 'Broker Distribution' }
});
// contract, book, product, first, middle, last, gender, dob, status, advisers [[salesCode, share]], premium, start date, scenario
const TRANSITION_ROWS = [
  ['102790001001', 'open', 'OMPL', 'ELIZE', 'MARIA', 'VAN ROOYEN', 'F', '03/02/1978', 'ACTIVE POLICY', [['610901', 100]], 450, '12/03/2019', 'transition-open'],
  ['102790002001', 'open', 'OMPFL', 'GERHARD', 'JAN', 'MULLER', 'M', '11/11/1965', 'LAPSED', [['610901', 100]], 380, '03/10/2015', 'transition-lapsed'],
  ['102790003001', 'open', 'OMPL', 'NOMSA', 'JOYCE', 'KUBHEKA', 'F', '25/06/1982', 'ACTIVE POLICY', [['633310', 100]], 520, '23/04/2022', 'transition-imed-mismatch'],
  ['13394001/LSD/1', 'closed', 'GLD', 'SAMUEL', 'THABO', 'NKOSI', 'M', '08/06/1965', 'ACTIVE POLICY', [['610901', 60], ['600122', 20], ['633310', 20]], 300, '20/09/2003', 'transition-closed'],
  ['13394001/LSD/2', 'closed', 'GLD', 'SAMUEL', 'THABO', 'NKOSI', 'M', '08/06/1965', 'ACTIVE POLICY', [['610901', 100]], 150, '20/09/2003', 'transition-closed'],
  ['13394002/LSD/1', 'closed', 'GLD', 'LINDIWE', 'GRACE', 'SITHOLE', 'F', '14/01/1971', 'ACTIVE POLICY', [['610901', 100]], 200, '05/05/2008', 'transition-in-progress'],
  ['13394003/LSD/1', 'closed', 'GLD', 'PIETER', 'ANDRE', 'BOTHA', 'M', '30/03/1960', 'LAPSED', [['610901', 100]], 180, '14/02/2006', 'transition-lapsed'],
  ['15263901/LSFE/1', 'closed', 'GLFE', 'JOHANNES', 'PETRUS', 'FOURIE', 'M', '02/02/1959', 'ACTIVE POLICY', [['610901', 100]], 120, '11/07/2011', 'transition-closed']
];

TRANSITION_ROWS.forEach((r, j) => {
  const [contractNo, book, prod, first, middle, last, gender, dob, status, advs, premium, startDate, scenario] = r;
  const p = TRANSITION_PRODUCTS[prod];
  const i = ROWS.length + j;
  const base = contractNo.split('/')[0];
  let partyCode = 'BNCSGC-';
  for (let k = 0; k < 13; k++) partyCode += partyChars[(i * 31 + k * 17 + k * k) % partyChars.length];
  const lead = ADVISERS[advs[0][0]];
  policies.push({
    contractNo, book, transition: true,
    quotationNumber: book === 'closed' ? contractNo : `${base.slice(0, 9)}/Q0000${24731666 - j * 48211}`,
    ...p,
    status, subStatus: status === 'LAPSED' ? 'Lapsed' : 'Active',
    startDate, expiryDate: '', currency: 'South African Rand', branch: 'HO',
    coverAmount: money(premium * 2400), scenario,
    owner: {
      partyCode, title: gender === 'F' ? 'MS' : 'MR', firstName: first, middleName: middle, lastName: last,
      initials: first[0] + middle[0], dob, idNumber: saId(dob, gender, 2203 + j * 577), gender, nature: 'Individual', identityType: 'RSA ID'
    },
    basic: {
      quoteInstanceNumber: base.slice(0, 9), waiverNumber: '', distributionChannel: lead.channel, segment: 'Personal Finance SA',
      salesCode: advs[0][0], salesCodeType: '0', adviserPartyCode: lead.party, brokerExternalReference: '',
      quoteDate: startDate, quoteExpiryDate: '03/09/2026', applicationDate: startDate, policyStartDate: startDate,
      nextPolicyAnniversaryDate: nextAnniv(startDate), nextDueDate: nextDue(startDate), firstContributionDueDate: startDate,
      legalStructure: 'Natural Person', minor: 'No', savingsNeed: 'Protection', noDealings: 'No', amendPotReason: '', removeReason: '',
      planType: 'Risk', personalisedInvestmentName: '', amountDeductedEachRegularContribution: '0.00',
      amountDeductedFromContractValue: '0.00', amountDeductedFirstRegularContribution: '0.00', amountDeductedLumpSum: '0.00',
      investmentTermMonths: '240', marketValue: '0.00', maturityDate: '', grossYield: '8.60', netYield: '8.25',
      vestedPercentage: '0.00', nonVestedPercentage: '0.00',
      transactionAdminFeeScaling: '100.00', reductionFeeScaling: '100.00', mvaFeeScaling: '100.00'
    },
    contribution: {
      type: 'Regular', amount: money(premium), reference: `RG${310522700 + j * 6113}${startDate.replace(/\//g, '')}`,
      startDate, ceaseDate: '', method: 'Bank deduction', increase: 'Inflation-linked'
    },
    commission: {
      benefitName: p.benefit, type: 'As and when - Full Term', immediatePct: '0.00', ongoingPct: '0.00',
      primaryUpfront: '0.00', secondaryUpfront: '0.00', eachPremium: '0.00', immediately: '0.00',
      scalingPct: '100.00', distributionFeeScalingPct: '0.00'
    },
    submissionDefaults: { legalVerification: 'Approved' }
  });
  fees.push({ contractNo, vatInclusive: 0, vatExclusive: 0, effectiveDate: startDate });
  advs.forEach(([sales, share], k) => {
    const a = ADVISERS[sales];
    advisers.push({
      id: `${contractNo}-A${k + 1}`, contractNo, partyCode: a.party, salesCode: sales, name: a.name,
      type: 'Broker', segment: 'Personal Finance SA', distributionChannel: a.channel, primary: k === 0, share
    });
  });
});
// As in the recording (46:30): a finalised quote effective 01/11/2026 blocks the move (56000) until then.
endorsements.push(
  historic('13394001/LSD/1', 1, 'Add Beneficiary', '05/05/2024'),
  historic('13394002/LSD/1', 1, 'Apply CAPI', '01/11/2025'),
  historic('13394002/LSD/1', 2, 'Indicative CAPI', '01/11/2026')
);

// The intermediary register (what Intermediary Enquiry returns): every adviser, by sales code.
const intermediaries = Object.entries(ADVISERS).map(([salesCode, a]) => ({
  salesCode, partyCode: a.party, name: a.name, distributionChannel: a.channel, salesCodeType: '0'
}));

// The Relationship Transition List (PUF and CUF) rows, in the list's own order. NEW ADVISOR PARTY CODE is
// added so the agent does not need Intermediary Enquiry (as suggested in the recording, 50:00).
const transitionList = {
  header: {
    date: '03/08/2026', areaManager: 'Ayanda Khoza', cell: '0820000101', office: '0210000101',
    email: 'akhoza@example.com', icc: '', brokerType: 'PFA'
  },
  rows: [
    ['102790001001', 'EM', 'VAN ROOYEN', 'Open book, active, adviser matches: move it'],
    ['102790002001', 'GJ', 'MULLER', 'Open book, LAPSED: do not move, note "Lapsed" on the list'],
    ['102790003001', 'NJ', 'KUBHEKA', 'Open book, active, but the current adviser is 633310, not 610901: stop, note the mismatch'],
    ['13394001', 'ST', 'NKOSI', 'Not in the open book. Closed book: two benefits, LSD/1 (three advisers) and LSD/2: move each'],
    ['13394002', 'LG', 'SITHOLE', 'Closed book, Endorse/Alter gives 56000 (quote effective 01/11/2026): diarise to 01/11/2026'],
    ['13394003', 'PA', 'BOTHA', 'Closed book, LAPSED: do not move'],
    ['15263901', 'JP', 'FOURIE', 'Closed book, GL Final Expenses, one benefit (LSFE/1): move it'],
    ['15269999', 'TM', 'DLAMINI', 'Not found in either book: note "Not found"']
  ].map(([policyNumber, initials, surname, expected]) => ({
    fromCode: '610901', fromName: ADVISERS['610901'].name, toCode: '620455', toName: ADVISERS['620455'].name,
    toPartyCode: ADVISERS['620455'].party, policyNumber, initials, surname, expected
  }))
};

const users = [
  { id: 'nzwane', name: 'Nandi Zwane', role: 'SYS-ADMIN', branch: 'HO', language: 'ENGLISH', kind: 'capturer' },
  { id: 'dvisser', name: 'Daniel Visser', role: 'PREM-ADM', branch: 'HO', language: 'ENGLISH', kind: 'verifier' }
];

const config = {
  batchDate: '03/08/2026', systemDate: SYSTEM_DATE, systemName: 'BaNCS_V11.0.3.4.72_071.ear',
  currency: 'South African Rand', vatRate: 0.15,
  // The closed book: a second BaNCS (its own link, login and password), same people, its own policies.
  closedBook: { systemName: 'BaNCS_V11.0.3.3.16_019.ear', password: 'Closed@2026' }
};

// The mailbox starts with the case email for the demo policy already in the Maker's inbox.
const mail = [{
  id: 'm1', to: 'nzwane', from: { name: 'Thandi Mokoena', title: 'Team Leader, ADAC, Personal Finance Operations' }, kind: 'case',
  contractNo: '119900001001', attachment: true, read: false, sentAt: { date: SYSTEM_DATE, time: '08:05' },
  subject: 'FW: Scale to zero SOP, fee switch-off for contract 119900001001'
}];

const seed = { config, users, policies, fees, advisers, endorsements, worklist, mail, intermediaries, transitionList };
const out = path.join(__dirname, '..', 'data-service', 'seed', 'seed.json');
fs.writeFileSync(out, JSON.stringify(seed, null, 2) + '\n');
console.log(`wrote ${out}: ${policies.length} policies, ${endorsements.length} endorsements, ${worklist.length} work list rows`);
