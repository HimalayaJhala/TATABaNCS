// Builds the calculation workbook for the S&I fee switch-off process, from the same seed the app uses,
// so every figure on the sheet is the figure BaNCS shows. The sheets hold live Excel formulas (and their
// results, so they also read correctly in a previewer):
//
//   Fee Switch-Off   what the client pays now, what they pay after the fee is set to 0, and the saving
//   Process Checks   the SOP's decisions per case: ID check, error 56000, skip-if-zero, Legal Verification
//   Split Fee        the split commission SOP: the new VAT Inclusive fee for the staying adviser's share
//   Latency Budget   the waits in a full run, and a suggested timeout per step for Seek
//
//   Quote Summary   the Endr Quote Summary figures: fee refund or collection, commission, clawback
//   EAC             the Effective Annual Cost at the four milestones
//
// Usage: npm run calcsheet   (also run by npm run reset). Close the file in Excel first.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { STEPS } = require('../data-service/settings');
const calc = require('../data-service/calc');

const ROOT = path.join(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-service', 'seed', 'seed.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'worklist');
const OUT = path.join(OUT_DIR, 'Fee Switch-Off Calculations.xlsx');

const VAT = 1.15, MONTHS = 12;
const SYS = seed.config.systemDate;
const key = d => d.split('/').reverse().join('');

// The same rounding as the formulas: ROUND is half away from zero, ROUNDDOWN truncates, and a 1E-9 guard
// is added first so binary noise (971.1749999999999 for 971.175) cannot flip an exact half-cent.
const G = 1e-9;
const rnd = (x, d) => { const k = 10 ** d; return Math.round((x + G) * k) / k; };
const rdn = (x, d) => { const k = 10 ** d; return Math.floor((x + G) * k) / k; };

// ---------- the data, one row per policy ----------
const feeOf = Object.fromEntries(seed.fees.map(f => [f.contractNo, f]));
const listOf = Object.fromEntries(seed.worklist.map(w => [w.contractNumber, w]));
const rows = seed.policies.filter(p => !p.transition).map(p => {   // the S&I policies; the transition list has its own workbook
  const eps = seed.endorsements.filter(e => e.contractNo === p.contractNo);
  const block = eps.find(e => e.status === 'DRAFT ENDORSEMENT QUOTE' || (e.status === 'FINAL ENDORSEMENT QUOTE' && e.stage !== 'approved') || (e.status === 'FINAL ENDORSEMENT QUOTE' && key(e.effectiveDate) > key(SYS)));
  return {
    contract: p.contractNo,
    client: `${p.owner.firstName} ${p.owner.lastName}`,
    product: p.productName,
    scenario: p.scenario,
    mv: Number(p.basic.marketValue),
    contribution: Number(p.contribution.amount),
    fee: feeOf[p.contractNo].vatInclusive,
    bancsId: p.owner.idNumber,
    listId: listOf[p.contractNo].idNumber,
    declared: listOf[p.contractNo].declarationSignedDate,
    legal: p.submissionDefaults.legalVerification,
    blocked: !!block,
    blockReason: block ? `Quote ${block.quotationNumber}: ${block.status}${key(block.effectiveDate) > key(SYS) ? ', effective ' + block.effectiveDate : ''}` : ''
  };
});
const N = rows.length, FIRST = 5, LAST = FIRST + N - 1;

// ---------- the formulas, written once as text and once as JS so the cached results agree ----------
const outcome = r => (r.bancsId !== r.listId ? 'STOP: ID number does not match the work list'
  : r.blocked ? 'STOP: error 56000, an endorsement is already in progress'
  : r.fee === 0 ? 'SKIP: fee already 0.000'
  : 'PROCEED: set VAT Inclusive fee to 0');

// ---------- workbook ----------
const FONT = { name: 'Calibri', size: 11 };
const BLUE = { name: 'Calibri', size: 11, color: { argb: 'FF0000FF' } };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const NOTE = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF595959' } };
const thin = { style: 'thin', color: { argb: 'FFD9D9D9' } };

function frame(ws, title, note, headers, widths) {
  ws.getCell('A1').value = title; ws.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1F3864' } };
  ws.getCell('A2').value = note; ws.getCell('A2').font = NOTE;
  const h = ws.getRow(4);
  headers.forEach((t, i) => { const c = h.getCell(i + 1); c.value = t; c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; c.alignment = { wrapText: true, vertical: 'middle', horizontal: i < 4 ? 'left' : 'center' }; });
  h.height = 48;
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];
}
const put = (ws, ref, value, { fmt, input, bold, align } = {}) => {
  const c = ws.getCell(ref);
  c.value = value; c.font = input ? BLUE : (bold ? { ...FONT, bold: true } : FONT);
  if (fmt) c.numFmt = fmt;
  if (align) c.alignment = { horizontal: align };
  c.border = { bottom: thin };
  return c;
};
const F = (formula, result) => ({ formula, result });
const lookup = (sheet, col, last, ref) => `INDEX('${sheet}'!$${col}$${FIRST}:$${col}$${last},MATCH(${ref},'${sheet}'!$A$${FIRST}:$A$${last},0))`;

function addOutcomeColours(ws, range, col, firstRow) {
  const rule = (text, argb) => ({ type: 'containsText', operator: 'containsText', text, formulae: [`NOT(ISERROR(SEARCH("${text}",${col}${firstRow})))`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb } } } });
  ws.addConditionalFormatting({ ref: range, rules: [rule('STOP', 'FFFFC7CE'), rule('SKIP', 'FFFFEB9C'), rule('PROCEED', 'FFC6EFCE')] });
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Personal Finance Operations'; wb.created = new Date('2026-08-04T08:00:00Z');

  // ---- README ----
  const rd = wb.addWorksheet('README', { properties: { tabColor: { argb: 'FF1F3864' } } });
  rd.getColumn(1).width = 30; rd.getColumn(2).width = 110;
  const lines = [
    ['Fee Switch-Off Calculations', null, 'title'],
    ['What this is', 'The numbers behind the S&I SWITCHING OFF FEES SOP, on the same synthetic policies the BaNCS demo uses, so a person (or Seek) can check what BaNCS should show at each step.'],
    ['', ''],
    ['Fee Switch-Off', 'Per policy: the VAT Inclusive Asset Advice Fee now, its VAT Exclusive value, the rand a year it costs the client, and the saving once the fee is set to 0.'],
    ['Process Checks', 'Per policy: the SOP\'s decisions in order. ID check against the work list, error 56000, skip if the fee is already 0.000, and the Legal Verification and acceptance-date actions.'],
    ['Split Fee', 'The split commission SOP: the new VAT Inclusive fee when the staying adviser keeps a given share, for example 0.575 at 50% gives 0.287 and 0.250 exclusive, as in the SOP.'],
    ['Latency Budget', 'Time spent waiting in one full case on the Normal and Stress profiles, and a suggested timeout per step for Seek.'],
    ['Quote Summary', 'What Calculate Premium shows on Endr Quote Summary: the refund (or collection) of the fee for the days left in the fee period, the adviser commission and its clawback. Fee period = previous to next due date; only that period is adjusted.'],
    ['EAC', 'The Effective Annual Cost at the four milestones (years 1, 5, 10 and the term; 1, 3, 5 and the term for a 10-year policy), by Investment, Advice, Admin and Other. Excel FV and RATE on monthly contributions, with and without charges.'],
    ['', ''],
    ['How to read it', 'Blue figures are inputs (from BaNCS or the work list); yellow cells can be changed to try other values; black figures are formulas. Nothing on a sheet is typed over a formula.'],
    ['VAT', 'VAT Exclusive = VAT Inclusive / 1.15, rounded to 3 decimals, exactly as BaNCS derives it after Save. VAT is set on the Assumptions sheet.'],
    ['Rounding', 'Rand amounts round to 2 decimals and fees to 3, half up. Each ROUND carries a +1E-9 guard so binary noise cannot flip an exact half (84,450 x 1.15% is exactly 971.175 and must show 971.18).'],
    ['Fee units', 'The fee is a percentage a year of the market value (0.575 means 0.575%). ASSUMPTION: confirm with Old Mutual that the asset advice fee is charged as a yearly percentage of market value; if it is not, only the rand columns change.'],
    ['Split rule', 'New VAT Inclusive fee = current fee x the staying adviser\'s asset advice fee share, rounded DOWN to 3 decimals. This is the build\'s reading of the SOP\'s "adjust the fee for the remaining adviser to receive the same fees"; it reproduces the SOP\'s 0.575 to 0.287.'],
    ['Where it comes from', 'Generated from data-service/seed/seed.json by scripts/build-calcsheet.js (npm run calcsheet). Change the seed, regenerate, and the sheet follows. npm run test:sheet checks the sheet against the running app.'],
    ['Synthetic data', 'Every client, ID number and amount is fictional.']
  ];
  lines.forEach(([a, b, kind], i) => {
    const r = i + 1;
    if (kind === 'title') { rd.getCell(`A${r}`).value = a; rd.getCell(`A${r}`).font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1F3864' } }; return; }
    rd.getCell(`A${r}`).value = a; rd.getCell(`A${r}`).font = { ...FONT, bold: true };
    rd.getCell(`B${r}`).value = b; rd.getCell(`B${r}`).font = FONT; rd.getCell(`B${r}`).alignment = { wrapText: true, vertical: 'top' };
    rd.getCell(`A${r}`).alignment = { vertical: 'top' };
  });

  // ---- Assumptions ----
  const as = wb.addWorksheet('Assumptions');
  as.getColumn(1).width = 44; as.getColumn(2).width = 14; as.getColumn(3).width = 70;
  as.getCell('A1').value = 'Assumptions'; as.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1F3864' } };
  [['VAT factor (1 + 15%)', VAT, 'South African VAT at 15%. BaNCS shows VAT Exclusive = VAT Inclusive / this.'],
   ['Months in a year', MONTHS, 'Used for the monthly fee.'],
   ['System date', SYS, 'The BaNCS system date; an approved quote effective after it blocks a new endorsement (error 56000).']].forEach(([a, v, n], i) => {
    const r = i + 3; put(as, `A${r}`, a); const c = put(as, `B${r}`, v, { input: true }); c.fill = INPUT_FILL; as.getCell(`C${r}`).value = n; as.getCell(`C${r}`).font = NOTE;
  });
  const VATREF = 'Assumptions!$B$3', MREF = 'Assumptions!$B$4';
  const dateOf = d => { const [dd, mm, yy] = d.split('/').map(Number); return new Date(Date.UTC(yy, mm - 1, dd)); };
  [['Endorsement effective date', dateOf(SYS), 'The date the fee change takes effect on the quote (the BaNCS system date unless a later date is chosen). Drives the refund.', 'dd/mm/yyyy'],
   ['Fund charge, LISP (% a year)', calc.ASSUMPTIONS.investmentCharge.OMSLISPI, 'ASSUMPTION: fund total expense ratio for OMS LISP Investment. Confirm with Old Mutual.', '0.00'],
   ['Fund charge, TFI II (% a year)', calc.ASSUMPTIONS.investmentCharge.OMSTFII, 'ASSUMPTION: fund total expense ratio for OMS TFI II. Confirm with Old Mutual.', '0.00'],
   ['Platform admin charge (% a year)', calc.ASSUMPTIONS.adminCharge, 'ASSUMPTION: matches the 0.35 used for the net yield in the data.', '0.00'],
   ['Initial charge (% of each contribution)', calc.ASSUMPTIONS.contributionCharge, 'From the data: R10.35 off R600.00 (policy A) is 1.725%.', '0.000'],
   ['Other charges (% a year)', calc.ASSUMPTIONS.otherCharge, 'Nothing else is charged on these products.', '0.00']].forEach(([a, v, n, f], i) => {
    const r = i + 6; put(as, `A${r}`, a); const c = put(as, `B${r}`, v, { input: true, fmt: f }); c.fill = INPUT_FILL; as.getCell(`C${r}`).value = n; as.getCell(`C${r}`).font = NOTE;
  });
  const EFFREF = 'Assumptions!$B$6', TERLISP = 'Assumptions!$B$7', TERTFI = 'Assumptions!$B$8', ADMREF = 'Assumptions!$B$9', INITREF = 'Assumptions!$B$10', OTHREF = 'Assumptions!$B$11';

  // ---- Fee Switch-Off ----
  const fw = wb.addWorksheet('Fee Switch-Off', { properties: { tabColor: { argb: 'FF548235' } } });
  frame(fw, 'Fee Switch-Off: what the client pays now and after the fee is set to 0',
    'Blue = from BaNCS. Yellow = change to try another new fee. The saving only counts policies the process will actually change (see Process Checks).',
    ['Contract No.', 'Client', 'Product', 'Scenario', 'Market value (R)', 'Monthly contribution (R)', 'VAT Inclusive fee now (%)', 'VAT Exclusive fee now (%)', 'Fee a year now (R)', 'Fee a month now (R)', 'New VAT Inclusive fee (%)', 'New VAT Exclusive fee (%)', 'Fee a year after (R)', 'Saving a year (R)', 'Will the process change it?'],
    [15, 24, 20, 18, 15, 15, 14, 14, 15, 14, 14, 14, 15, 15, 16]);
  rows.forEach((r, i) => {
    const n = FIRST + i;
    r.excl = rnd(r.fee / VAT, 3); r.annual = rnd(r.mv * r.fee / 100, 2); r.monthly = rnd(r.annual / MONTHS, 2);
    r.newFee = 0; r.newExcl = rnd(r.newFee / VAT, 3); r.annualAfter = rnd(r.mv * r.newFee / 100, 2); r.saving = rnd(r.annual - r.annualAfter, 2);
    r.outcome = outcome(r); r.processed = r.outcome.startsWith('PROCEED');
    put(fw, `A${n}`, r.contract, { input: true }); put(fw, `B${n}`, r.client, { input: true }); put(fw, `C${n}`, r.product, { input: true }); put(fw, `D${n}`, r.scenario, { input: true });
    put(fw, `E${n}`, r.mv, { input: true, fmt: '#,##0.00' }); put(fw, `F${n}`, r.contribution, { input: true, fmt: '#,##0.00' });
    put(fw, `G${n}`, r.fee, { input: true, fmt: '0.000' });
    put(fw, `H${n}`, F(`ROUND(G${n}/${VATREF}+1E-9,3)`, r.excl), { fmt: '0.000' });
    put(fw, `I${n}`, F(`ROUND(E${n}*G${n}/100+1E-9,2)`, r.annual), { fmt: '#,##0.00' });
    put(fw, `J${n}`, F(`ROUND(I${n}/${MREF}+1E-9,2)`, r.monthly), { fmt: '#,##0.00' });
    const k = put(fw, `K${n}`, r.newFee, { input: true, fmt: '0.000' }); k.fill = INPUT_FILL;
    put(fw, `L${n}`, F(`ROUND(K${n}/${VATREF}+1E-9,3)`, r.newExcl), { fmt: '0.000' });
    put(fw, `M${n}`, F(`ROUND(E${n}*K${n}/100+1E-9,2)`, r.annualAfter), { fmt: '#,##0.00' });
    put(fw, `N${n}`, F(`I${n}-M${n}`, r.saving), { fmt: '#,##0.00' });
    put(fw, `O${n}`, F(`IF(LEFT(${lookup('Process Checks', 'K', LAST, `$A${n}`)},7)="PROCEED","Yes","No")`, r.processed ? 'Yes' : 'No'), { align: 'center' });
  });
  const T = LAST + 2;
  const sumIf = col => rnd(rows.filter(r => r.processed).reduce((t, r) => t + r[col], 0), 2);
  put(fw, `A${T}`, 'Total for the policies the process changes', { bold: true });
  [['I', 'annual'], ['M', 'annualAfter'], ['N', 'saving']].forEach(([c, f]) => put(fw, `${c}${T}`, F(`SUMIF($O$${FIRST}:$O$${LAST},"Yes",${c}${FIRST}:${c}${LAST})`, sumIf(f)), { bold: true, fmt: '#,##0.00' }));
  put(fw, `O${T}`, F(`COUNTIF($O$${FIRST}:$O$${LAST},"Yes")&" policies"`, `${rows.filter(r => r.processed).length} policies`), { bold: true, align: 'center' });
  fw.autoFilter = { from: 'A4', to: `O${LAST}` };

  // ---- Process Checks ----
  const pc = wb.addWorksheet('Process Checks', { properties: { tabColor: { argb: 'FFBF8F00' } } });
  frame(pc, 'Process Checks: the SOP\'s decisions, in order',
    'Order of the checks: (1) ID number against the work list, (2) Endorse/Alter allowed? (error 56000), (3) skip if the fee is already 0.000. Compare Expected outcome with what Seek does.',
    ['Contract No.', 'Client', 'ID number in BaNCS', 'ID number on the work list', 'ID check', 'Endorsement already in progress?', 'What is in progress', 'VAT Inclusive fee now (%)', 'Legal Verification default', 'Declaration signed (work list)', 'Expected outcome', 'Status path if processed', 'Legal Verification action', 'Acceptance date to enter'],
    [15, 24, 17, 17, 12, 14, 44, 13, 14, 15, 52, 52, 30, 16]);
  rows.forEach((r, i) => {
    const n = FIRST + i;
    r.idCheck = r.bancsId === r.listId ? 'MATCH' : 'MISMATCH';
    r.path = r.processed ? 'ACTIVE POLICY > DRAFT ENDORSEMENT QUOTE > FINAL ENDORSEMENT QUOTE (Submitted) > Approved Endorsed Quote' : 'No endorsement is raised';
    r.legalAction = !r.processed ? 'n/a' : (r.legal === '' ? 'Select Approved before Submit' : 'Already Approved');
    r.accDate = r.processed ? r.declared : 'n/a';
    put(pc, `A${n}`, r.contract, { input: true }); put(pc, `B${n}`, r.client, { input: true });
    put(pc, `C${n}`, r.bancsId, { input: true, fmt: '@' }); put(pc, `D${n}`, r.listId, { input: true, fmt: '@' });
    put(pc, `E${n}`, F(`IF(C${n}=D${n},"MATCH","MISMATCH")`, r.idCheck), { align: 'center' });
    put(pc, `F${n}`, r.blocked ? 'Yes' : 'No', { input: true, align: 'center' });
    put(pc, `G${n}`, r.blockReason, { input: true });
    put(pc, `H${n}`, F(lookup('Fee Switch-Off', 'G', LAST, `$A${n}`), r.fee), { fmt: '0.000' });
    put(pc, `I${n}`, r.legal === '' ? '(blank)' : r.legal, { input: true, align: 'center' });
    put(pc, `J${n}`, r.declared, { input: true, align: 'center' });
    put(pc, `K${n}`, F(`IF(E${n}="MISMATCH","STOP: ID number does not match the work list",IF(F${n}="Yes","STOP: error 56000, an endorsement is already in progress",IF(H${n}=0,"SKIP: fee already 0.000","PROCEED: set VAT Inclusive fee to 0")))`, r.outcome));
    put(pc, `L${n}`, F(`IF(LEFT(K${n},7)="PROCEED","ACTIVE POLICY > DRAFT ENDORSEMENT QUOTE > FINAL ENDORSEMENT QUOTE (Submitted) > Approved Endorsed Quote","No endorsement is raised")`, r.path));
    put(pc, `M${n}`, F(`IF(LEFT(K${n},7)<>"PROCEED","n/a",IF(I${n}="(blank)","Select Approved before Submit","Already Approved"))`, r.legalAction));
    put(pc, `N${n}`, F(`IF(LEFT(K${n},7)="PROCEED",J${n},"n/a")`, r.accDate), { align: 'center' });
  });
  addOutcomeColours(pc, `K${FIRST}:K${LAST}`, 'K', FIRST);
  pc.autoFilter = { from: 'A4', to: `N${LAST}` };
  const tally = (pre) => rows.filter(r => r.outcome.startsWith(pre)).length;
  const S0 = LAST + 2;
  put(pc, `A${S0}`, 'Summary', { bold: true });
  [['PROCEED', 'Policies the process will change'], ['SKIP', 'Skipped: fee already 0.000'], ['STOP', 'Stopped: ID mismatch or error 56000']].forEach(([pre, label], i) => {
    put(pc, `B${S0 + 1 + i}`, label); put(pc, `C${S0 + 1 + i}`, F(`COUNTIF($K$${FIRST}:$K$${LAST},"${pre}*")`, tally(pre)), { bold: true, align: 'center' });
  });

  // ---- Split Fee ----
  const sp = wb.addWorksheet('Split Fee', { properties: { tabColor: { argb: 'FF2F75B5' } } });
  frame(sp, 'Split Fee: the new VAT Inclusive fee when the staying adviser keeps a share',
    'Yellow = the staying adviser\'s asset advice fee share (%). New fee = current fee x share, rounded down to 3 decimals. The first two rows are the SOP\'s own example and the 60/40 case.',
    ['Contract No.', 'Client', 'Note', 'Market value (R)', 'VAT Inclusive fee now (%)', 'Staying adviser share (%)', 'Other adviser(s) share (%)', 'New VAT Inclusive fee (%)', 'New VAT Exclusive fee (%)', 'Fee a year before (R)', 'Fee a year after (R)', 'Reduction a year (R)'],
    [15, 24, 26, 15, 14, 14, 14, 14, 14, 15, 15, 15]);
  const A = rows[0];
  const splitRows = [
    { r: A, note: 'SOP example: 50 / 50', share: 50 },
    { r: A, note: '60 / 40 split', share: 60 },
    ...rows.filter(r => r.scenario === 'happy' && r !== A).map(r => ({ r, note: 'Single adviser, split 50 / 50', share: 50 }))
  ];
  const SL = FIRST + splitRows.length - 1;
  splitRows.forEach(({ r, note, share }, i) => {
    const n = FIRST + i;
    const o = { newFee: rdn(r.fee * share / 100, 3) };
    o.newExcl = rnd(o.newFee / VAT, 3); o.before = rnd(r.mv * r.fee / 100, 2); o.after = rnd(r.mv * o.newFee / 100, 2); o.cut = rnd(o.before - o.after, 2);
    put(sp, `A${n}`, r.contract, { input: true });
    put(sp, `B${n}`, F(lookup('Fee Switch-Off', 'B', LAST, `$A${n}`), r.client));
    put(sp, `C${n}`, note, { input: true });
    put(sp, `D${n}`, F(lookup('Fee Switch-Off', 'E', LAST, `$A${n}`), r.mv), { fmt: '#,##0.00' });
    put(sp, `E${n}`, F(lookup('Fee Switch-Off', 'G', LAST, `$A${n}`), r.fee), { fmt: '0.000' });
    const f = put(sp, `F${n}`, share, { input: true, fmt: '0.00' }); f.fill = INPUT_FILL;
    put(sp, `G${n}`, F(`100-F${n}`, 100 - share), { fmt: '0.00' });
    put(sp, `H${n}`, F(`ROUNDDOWN(E${n}*F${n}/100+1E-9,3)`, o.newFee), { fmt: '0.000' });
    put(sp, `I${n}`, F(`ROUND(H${n}/${VATREF}+1E-9,3)`, o.newExcl), { fmt: '0.000' });
    put(sp, `J${n}`, F(`ROUND(D${n}*E${n}/100+1E-9,2)`, o.before), { fmt: '#,##0.00' });
    put(sp, `K${n}`, F(`ROUND(D${n}*H${n}/100+1E-9,2)`, o.after), { fmt: '#,##0.00' });
    put(sp, `L${n}`, F(`J${n}-K${n}`, o.cut), { fmt: '#,##0.00' });
  });
  sp.autoFilter = { from: 'A4', to: `L${SL}` };

  // ---- Latency Budget ----
  const lb = wb.addWorksheet('Latency Budget', { properties: { tabColor: { argb: 'FFC00000' } } });
  frame(lb, 'Latency Budget: where a full case spends its time',
    'Seconds come from the latency table on the BaNCS login page. Policy search happens twice per case (capture and verification). Suggested timeout = Stress x 1.5, so a bot that gives up earlier than this will fail on a slow day.',
    ['Step', 'Observed in the recording', 'Normal (s)', 'Stress (s)', 'Times per case', 'Normal total (s)', 'Stress total (s)', 'Suggested timeout (s)'],
    [44, 48, 12, 12, 12, 14, 14, 16]);
  const times = { search: 2 };
  let tn = 0, ts = 0, mx = 0;
  STEPS.forEach((st, i) => {
    const n = FIRST + i, t = times[st.key] || 1;
    tn += st.normal * t; ts += st.stress * t; mx = Math.max(mx, st.stress);
    put(lb, `A${n}`, st.label); put(lb, `B${n}`, st.observed);
    put(lb, `C${n}`, st.normal, { input: true, fmt: '0', align: 'center' }); put(lb, `D${n}`, st.stress, { input: true, fmt: '0', align: 'center' });
    const e = put(lb, `E${n}`, t, { input: true, fmt: '0', align: 'center' }); e.fill = INPUT_FILL;
    put(lb, `F${n}`, F(`C${n}*E${n}`, st.normal * t), { fmt: '0', align: 'center' });
    put(lb, `G${n}`, F(`D${n}*E${n}`, st.stress * t), { fmt: '0', align: 'center' });
    put(lb, `H${n}`, F(`ROUNDUP(D${n}*1.5,0)`, Math.ceil(st.stress * 1.5)), { fmt: '0', align: 'center' });
  });
  const LL = FIRST + STEPS.length - 1, LT = LL + 2;
  put(lb, `A${LT}`, 'One full case', { bold: true });
  put(lb, `F${LT}`, F(`SUM(F${FIRST}:F${LL})`, tn), { bold: true, fmt: '0', align: 'center' });
  put(lb, `G${LT}`, F(`SUM(G${FIRST}:G${LL})`, ts), { bold: true, fmt: '0', align: 'center' });
  put(lb, `A${LT + 1}`, 'In minutes', { bold: true });
  put(lb, `F${LT + 1}`, F(`ROUND(F${LT}/60,1)`, rnd(tn / 60, 1)), { bold: true, fmt: '0.0', align: 'center' });
  put(lb, `G${LT + 1}`, F(`ROUND(G${LT}/60,1)`, rnd(ts / 60, 1)), { bold: true, fmt: '0.0', align: 'center' });
  put(lb, `A${LT + 2}`, 'Longest single wait (Stress)', { bold: true });
  put(lb, `G${LT + 2}`, F(`MAX(D${FIRST}:D${LL})`, mx), { bold: true, fmt: '0', align: 'center' });


  // ---- Quote Summary ----
  const polOf = Object.fromEntries(seed.policies.map(p => [p.contractNo, p]));
  const qs = wb.addWorksheet('Quote Summary', { properties: { tabColor: { argb: 'FF7030A0' } } });
  frame(qs, 'Quote Summary: what Calculate Premium shows on Endr Quote Summary',
    'The fee refund (or collection), the adviser commission and the clawback, worked out from the fee change on the Fee Switch-Off sheet (its New VAT Inclusive fee column). Same method as BaNCS: see the README sheet and Assumptions.',
    ['Contract No.', 'Client', 'Market value (R)', 'VAT Inclusive fee now (%)', 'New VAT Inclusive fee (%)', 'Fee a year before (R)', 'Fee a year after (R)', 'Fee a month before (R)', 'Fee a month after (R)', 'Monthly fee difference (R)', 'Next due date', 'Previous due date', 'Days in fee period', 'Effective date', 'Days left in period', 'Refund to client (R)', 'Collection from client (R)', 'Commission scaling (%)', 'Commission clawback (R)', 'Adviser commission, rest of period (R)', 'Ongoing (AAW) commission (%)', 'Total endorsement premium (R)', 'Commission payable immediately (R)'],
    [15, 24, 14, 13, 13, 13, 13, 13, 13, 13, 13, 13, 11, 13, 11, 13, 13, 12, 13, 15, 14, 14, 15]);
  const qsRow = {};
  rows.forEach((r, i) => {
    const n = FIRST + i, p = polOf[r.contract];
    r.q = calc.compute({ policy: p, feeBefore: r.fee, feeAfter: r.newFee, effectiveDate: SYS });
    qsRow[r.contract] = n;
    put(qs, `A${n}`, r.contract, { input: true });
    put(qs, `B${n}`, F(lookup('Fee Switch-Off', 'B', LAST, `$A${n}`), r.client));
    put(qs, `C${n}`, F(lookup('Fee Switch-Off', 'E', LAST, `$A${n}`), r.mv), { fmt: '#,##0.00' });
    put(qs, `D${n}`, F(lookup('Fee Switch-Off', 'G', LAST, `$A${n}`), r.fee), { fmt: '0.000' });
    put(qs, `E${n}`, F(lookup('Fee Switch-Off', 'K', LAST, `$A${n}`), r.newFee), { fmt: '0.000' });
    put(qs, `F${n}`, F(`ROUND(C${n}*D${n}/100+1E-9,2)`, r.q.annualBefore), { fmt: '#,##0.00' });
    put(qs, `G${n}`, F(`ROUND(C${n}*E${n}/100+1E-9,2)`, r.q.annualAfter), { fmt: '#,##0.00' });
    put(qs, `H${n}`, F(`ROUND(F${n}/${MREF}+1E-9,2)`, r.q.monthlyBefore), { fmt: '#,##0.00' });
    put(qs, `I${n}`, F(`ROUND(G${n}/${MREF}+1E-9,2)`, r.q.monthlyAfter), { fmt: '#,##0.00' });
    put(qs, `J${n}`, F(`ROUND(H${n}-I${n}+1E-9,2)`, r.q.difference), { fmt: '#,##0.00' });
    put(qs, `K${n}`, dateOf(p.basic.nextDueDate), { input: true, fmt: 'dd/mm/yyyy' });
    put(qs, `L${n}`, F(`EDATE(K${n},-1)`, calc.serial(r.q.period.previousDue)), { fmt: 'dd/mm/yyyy' });
    put(qs, `M${n}`, F(`K${n}-L${n}`, r.q.period.days), { fmt: '0', align: 'center' });
    put(qs, `N${n}`, F(EFFREF, calc.serial(SYS)), { fmt: 'dd/mm/yyyy' });
    put(qs, `O${n}`, F(`MAX(0,MIN(M${n},K${n}-N${n}))`, r.q.period.remaining), { fmt: '0', align: 'center' });
    put(qs, `P${n}`, F(`IF(J${n}>0,ROUND(J${n}*O${n}/M${n}+1E-9,2),0)`, r.q.refund), { fmt: '#,##0.00' });
    put(qs, `Q${n}`, F(`IF(J${n}<0,ROUND(-J${n}*O${n}/M${n}+1E-9,2),0)`, r.q.collection), { fmt: '#,##0.00' });
    put(qs, `R${n}`, Number(p.commission.scalingPct), { input: true, fmt: '0.00' });
    put(qs, `S${n}`, F(`ROUND(P${n}/${VATREF}*R${n}/100+1E-9,2)`, r.q.clawback), { fmt: '#,##0.00' });
    put(qs, `T${n}`, F(`ROUND(I${n}/${VATREF}*O${n}/M${n}*R${n}/100+1E-9,2)`, r.q.commission), { fmt: '#,##0.00' });
    put(qs, `U${n}`, F(`ROUND(E${n}/${VATREF}*R${n}/100+1E-9,3)`, r.q.commissionSummary.ongoingPct), { fmt: '0.000' });
    put(qs, `V${n}`, F(lookup('Fee Switch-Off', 'F', LAST, `$A${n}`), r.contribution), { fmt: '#,##0.00' });
    put(qs, `W${n}`, F(`-S${n}`, r.q.commissionSummary.immediately), { fmt: '#,##0.00' });
  });
  qs.autoFilter = { from: 'A4', to: `W${LAST}` };

  // ---- EAC ----
  const ea = wb.addWorksheet('EAC', { properties: { tabColor: { argb: 'FF7030A0' } } });
  frame(ea, 'EAC: the Effective Annual Cost at the four milestones on Endr Quote Summary',
    'Monthly contributions are projected at the fund\'s gross growth with and without charges; EAC is the gap between the two annualised returns (Excel FV and RATE, annuity-due). Charges interact slightly, so each component is measured alone and scaled so the components add up to the total.',
    ['Contract No.', 'Milestone', 'Years', 'Term (months)', 'Months to milestone', 'Monthly contribution (R)', 'Gross growth (% a year)', 'Fund charge (%)', 'Advice fee after, VAT incl (%)', 'Admin charge (%)', 'Initial charge (%)', 'Other (%)',
     'All: net growth', 'All: final value (R)', 'All: IRR', 'All: EAC (pts)', 'Fund: net growth', 'Fund: final value (R)', 'Fund: IRR', 'Fund: EAC (pts)', 'Advice: net growth', 'Advice: final value (R)', 'Advice: IRR', 'Advice: EAC (pts)', 'Admin: net growth', 'Admin: final value (R)', 'Admin: IRR', 'Admin: EAC (pts)',
     'Sum of components', 'Investment', 'Advice', 'Admin', 'Other', 'EAC'],
    [15, 10, 8, 10, 11, 13, 12, 10, 12, 10, 10, 9, 11, 14, 10, 10, 11, 14, 10, 10, 11, 14, 10, 10, 11, 14, 10, 10, 11, 11, 11, 11, 9, 11]);
  const eaRow = {};
  let er = FIRST;
  rows.forEach(r => {
    const p = polOf[r.contract], q = qsRow[r.contract];
    const g = Number(p.basic.grossYield) / 100, c = r.contribution;
    const ter = calc.ASSUMPTIONS.investmentCharge[p.productCode] ?? 0.85, adm = calc.ASSUMPTIONS.adminCharge, u = calc.ASSUMPTIONS.contributionCharge, oth = calc.ASSUMPTIONS.otherCharge;
    const years = calc.milestoneYears(Number(p.basic.investmentTermMonths));
    const e = calc.eac(p, r.newFee);
    eaRow[r.contract] = er;
    years.forEach((y, k) => {
      const n = er, months = y * 12;
      const sc = { all: calc.scenarioParts(g, ter + adm + r.newFee + oth, u, c, months), inv: calc.scenarioParts(g, ter, 0, c, months), adv: calc.scenarioParts(g, r.newFee, 0, c, months), adm: calc.scenarioParts(g, adm, u, c, months) };
      put(ea, `A${n}`, r.contract, { input: true });
      put(ea, `B${n}`, k + 1, { input: true, align: 'center' });
      put(ea, `D${n}`, Number(p.basic.investmentTermMonths), { input: true, align: 'center' });
      put(ea, `C${n}`, F(`IF(ROUND(D${n}/12,0)>10,CHOOSE(B${n},1,5,10,ROUND(D${n}/12,0)),CHOOSE(B${n},1,3,5,ROUND(D${n}/12,0)))`, y), { align: 'center' });
      put(ea, `E${n}`, F(`C${n}*12`, months), { align: 'center' });
      put(ea, `F${n}`, F(lookup('Fee Switch-Off', 'F', LAST, `$A${n}`), c), { fmt: '#,##0.00' });
      put(ea, `G${n}`, Number(p.basic.grossYield), { input: true, fmt: '0.00' });
      put(ea, `H${n}`, F(`IF(ISNUMBER(SEARCH("TFI",${lookup('Fee Switch-Off', 'C', LAST, `$A${n}`)})),${TERTFI},${TERLISP})`, ter), { fmt: '0.00' });
      put(ea, `I${n}`, F(`INDEX('Quote Summary'!$E$${FIRST}:$E$${LAST},MATCH($A${n},'Quote Summary'!$A$${FIRST}:$A$${LAST},0))`, r.newFee), { fmt: '0.000' });
      put(ea, `J${n}`, F(ADMREF, adm), { fmt: '0.00' });
      put(ea, `K${n}`, F(INITREF, u), { fmt: '0.000' });
      put(ea, `L${n}`, F(OTHREF, oth), { fmt: '0.00' });
      const block = ([gn, fv, irr, ec], qExpr, uExpr, x) => {
        put(ea, `${gn}${n}`, F(`(G${n}-(${qExpr}))/100`, x.gn), { fmt: '0.00000' });
        put(ea, `${fv}${n}`, F(`F${n}*(1-(${uExpr})/100)*(((1+${gn}${n})^(E${n}/12)-1)/((1+${gn}${n})^(1/12)-1))*(1+${gn}${n})^(1/12)`, x.fv), { fmt: '#,##0.00' });
        put(ea, `${irr}${n}`, F(`(1+RATE(E${n},-F${n},0,${fv}${n},1))^12-1`, x.irr), { fmt: '0.00000' });
        put(ea, `${ec}${n}`, F(`(G${n}/100-${irr}${n})*100`, x.eac), { fmt: '0.0000' });
      };
      block(['M', 'N', 'O', 'P'], `H${n}+J${n}+I${n}+L${n}`, `K${n}`, sc.all);
      block(['Q', 'R', 'S', 'T'], `H${n}`, '0', sc.inv);
      block(['U', 'V', 'W', 'X'], `I${n}`, '0', sc.adv);
      block(['Y', 'Z', 'AA', 'AB'], `J${n}`, `K${n}`, sc.adm);
      const sum = sc.inv.eac + sc.adv.eac + sc.adm.eac;
      put(ea, `AC${n}`, F(`T${n}+X${n}+AB${n}`, sum), { fmt: '0.0000' });
      put(ea, `AD${n}`, F(`IF(AC${n}=0,0,ROUND(T${n}*P${n}/AC${n}+1E-9,2))`, e.rows.Investment[k]), { fmt: '0.00' });
      put(ea, `AE${n}`, F(`IF(AC${n}=0,0,ROUND(X${n}*P${n}/AC${n}+1E-9,2))`, e.rows.Advice[k]), { fmt: '0.00' });
      put(ea, `AF${n}`, F(`IF(AC${n}=0,0,ROUND(AB${n}*P${n}/AC${n}+1E-9,2))`, e.rows.Admin[k]), { fmt: '0.00' });
      put(ea, `AG${n}`, 0, { fmt: '0.00' });
      put(ea, `AH${n}`, F(`ROUND(AD${n}+AE${n}+AF${n}+AG${n}+1E-9,2)`, e.rows.EAC[k]), { bold: true, fmt: '0.00' });
      er++;
    });
  });
  ea.autoFilter = { from: 'A4', to: `AH${er - 1}` };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await wb.xlsx.writeFile(OUT);
  const t = k => rows.filter(r => r.outcome.startsWith(k)).length;
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${N} policies (${t('PROCEED')} proceed, ${t('SKIP')} skip, ${t('STOP')} stop), ${splitRows.length} split rows, ${STEPS.length} latency steps`);
}

main().catch(err => {
  if (err.code === 'EBUSY' || err.code === 'EPERM') console.error('The calculation workbook is open in Excel. Close it and run this again.');
  else console.error(err);
  process.exit(1);
});
