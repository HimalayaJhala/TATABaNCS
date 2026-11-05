// Writes the dummy work list in the developer tools ("Split Fee Cases and Annuities Aug 2026-synthetic"): the S&I tab
// only, as Excel and as a PDF. Each row is one test case, in this order:
//   1      happy path: the fee is switched off to 0, then Submit and Checker Activate
//   2      lapsed policy: Endorse/Alter gives 56020, nothing is changed
//   3      ID mismatch: the sheet's ID differs from the one BaNCS shows (a search on contract + ID finds nothing)
//   4      contract number with 11 digits: Search refuses it with 21002, nothing is changed
//   5 to 9 happy path, as row 1
// Rows come from the seed's full work list; the lapsed policy is not on it, so its row is written here.
// Usage: npm run dummy  (close the workbook in Excel first)
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-service', 'seed', 'seed.json'), 'utf8'));
const BASE = 'Split Fee Cases and Annuities Aug 2026-synthetic';
const OUT = path.join(ROOT, 'worklist', `${BASE}.xlsx`);

const fromList = (contractNumber, change = {}) => {
  const w = seed.worklist.find(x => x.contractNumber === contractNumber);
  if (!w) throw new Error(`${contractNumber} is not on the seed work list`);
  return { ...w, ...change };
};
const ROWS = [
  fromList('119900001001'),
  { assigned: '', approver: '', contractNumber: '102790002001', bancsProductCode: 'OMPFLIFE', productCode: 'OMPFL', intermediaryCode: '610901',
    productInstance: 0, commShare: 100, totalCommission: 8.75, idNumber: '6511117780080', declarationSignedDate: '01/08/2026' },
  fromList('110671307001'),                                            // seed scenario bancs-id-mismatch
  fromList('113162231001', { contractNumber: '11316223100' }),          // the last digit dropped
  fromList('112953094001'),
  fromList('113165622001'),
  fromList('113402518001'),
  fromList('112045877001'),
  fromList('112718459001')
];

// Guard the cases the rows stand for, so a reseed that changes them fails here and not in a demo.
const policy = no => seed.policies.find(p => p.contractNo === no);
const checks = [
  [policy('102790002001').status === 'LAPSED', 'row 2 is lapsed'],
  [policy('110671307001').owner.idNumber !== ROWS[2].idNumber, 'row 3 ID differs from BaNCS'],
  [ROWS[3].contractNumber.length === 11 && !policy(ROWS[3].contractNumber), 'row 4 has 11 digits and no policy'],
  ...[0, 4, 5, 6, 7, 8].map(i => {
    const no = ROWS[i].contractNumber, p = policy(no);
    const fee = seed.fees.find(f => f.contractNo === no);
    return [p && p.status === 'ACTIVE POLICY' && p.owner.idNumber === ROWS[i].idNumber && fee.vatInclusive > 0 &&
      !seed.endorsements.some(e => e.contractNo === no), `row ${i + 1} (${no}) is a clean happy path`];
  })
];
const failed = checks.filter(([pass]) => !pass);
if (failed.length) { failed.forEach(([, what]) => console.error('not true:', what)); process.exit(1); }

const COLUMNS = [
  ['Assigned', 'assigned', 15.75], ['Approver', 'approver', 12.88], ['ContractNumber', 'contractNumber', 20.5],
  ['BaNCS Product Code', 'bancsProductCode', 29], ['ProductCode', 'productCode', 16.63], ['IntermediaryCode', 'intermediaryCode', 25.5],
  ['Product Instance', 'productInstance', 20.63], ['Comm Share', 'commShare', 19.13], ['Total Commission', 'totalCommission', 19.75],
  ['ID Number', 'idNumber', 25.5], ['Declaration Signed Date', 'declarationSignedDate', 25.5], ['Status', 'status', 17.88], ['Summary', 'summary', 42.25]
];

async function xlsx() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Old Mutual Seek PoC (synthetic data)';
  wb.created = new Date('2026-10-28T15:02:57Z');
  const ws = wb.addWorksheet('S&I', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, key, width]) => ({ header, key, width }));
  // Numbers as the earlier copy had them (contract, intermediary and ID as whole numbers); the date stays text, dd/mm/yyyy.
  ROWS.forEach(r => ws.addRow({ ...r, contractNumber: Number(r.contractNumber), intermediaryCode: Number(r.intermediaryCode),
    idNumber: Number(r.idNumber), status: '', summary: '' }));
  ws.getRow(1).eachCell(c => {
    c.font = { name: 'Arial', bold: true };
    c.alignment = c.col >= 12 ? { wrapText: true } : { horizontal: 'center', vertical: 'middle' };
  });
  ws.eachRow((row, n) => { if (n > 1) row.eachCell({ includeEmpty: true }, c => { c.font = { name: 'Calibri', size: 11 }; }); });
  ['C', 'J'].forEach(col => ws.getColumn(col).eachCell((c, n) => { if (n > 1) c.numFmt = '0'; }));
  ws.getColumn('I').eachCell((c, n) => { if (n > 1) c.numFmt = '0.00'; });
  ws.getColumn('K').eachCell((c, n) => { if (n > 1) c.numFmt = '@'; });
  await wb.xlsx.writeFile(OUT);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${ROWS.length} S&I rows`);
}

async function pdf() {
  const puppeteer = require('puppeteer-core');
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const head = COLUMNS.map(([h]) => `<th>${esc(h)}</th>`).join('');
  const body = ROWS.map(r => `<tr>${COLUMNS.map(([, k]) => `<td>${esc(k === 'totalCommission' ? r[k].toFixed(2) : r[k])}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
body{font:10px Helvetica,Arial,sans-serif;color:#222;margin:0}h1{font-size:15px;margin:0 0 2px}p.sub{margin:0 0 10px;color:#666}
h2{font-size:13px;margin:0 0 6px;color:#1f4e79}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}
th{background:#1f4e79;color:#fff}tr:nth-child(even) td{background:#f2f6fa}thead{display:table-header-group}tr{break-inside:avoid}
</style><h1>Split Fee Cases and Annuities – Aug 2026 (synthetic)</h1>
<p class="sub">Synthetic test data for the Old Mutual Seek PoC. No real client names, ID numbers, contracts or adviser codes.</p>
<h2>S&amp;I</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const p = await b.newPage();
  await p.setContent(html);
  const out = path.join(ROOT, 'worklist', `${BASE}.pdf`);
  await p.pdf({ path: out, format: 'A4', landscape: true, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font:9px Helvetica,Arial,sans-serif;color:#666;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' } });
  await b.close();
  console.log(`wrote ${path.relative(ROOT, out)}`);
}

xlsx().then(pdf).catch(err => {
  console.error(err.code === 'EBUSY' || err.code === 'EPERM' ? 'The dummy sheet is open in Excel. Close it and run this again.' : err);
  process.exit(1);
});
