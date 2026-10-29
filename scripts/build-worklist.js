// Builds the Excel work list the team picks cases from, mirroring "Split Fee Cases and Annuities
// Jul 2026" in the 4 August 2026 recording: sheets OMEGA III, Annuities, OMEGA I, Flexcube, S&I,
// opening on S&I. The S&I rows come from the seed. ID Number and Declaration Signed Date are
// added at the right because the SOP's identity check and acceptance date need them.
// Usage: npm run worklist  (overwrites the workbook with a clean copy)
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-service', 'seed', 'seed.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'worklist');
const OUT = path.join(OUT_DIR, 'Split Fee Cases and Annuities Jul 2026.xlsx');

const FONT = { name: 'Calibri', size: 11 };

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map(([header, key, width]) => ({ header, key, width }));
  rows.forEach(r => ws.addRow(r));
  ws.eachRow(row => row.eachCell({ includeEmpty: true }, c => { c.font = FONT; }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

// Other teams' sheets: same shape as the recording, filler rows only. Not used by the S&I flow.
const SPLIT_COLS = [
  ['Assigned', 'assigned', 10], ['ContractNumber', 'contract', 15], ['ProductCode', 'product', 11],
  ['IntermediaryCode', 'imed', 16], ['Product Instance', 'instance', 15], ['Comm Share', 'share', 11],
  ['Total Commission', 'total', 16], ['Full Comm Split', 'full', 14]
];
function fillerRows(prefix, product, n, seedNo) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const contract = String(prefix + i * 7919 + seedNo);
    const shares = i % 3 === 0 ? [20, 80] : [50, 50];
    shares.forEach((share, k) => rows.push({
      assigned: '', contract, product, imed: String(300000 + ((i * 131 + k * 977 + seedNo) % 9000)),
      instance: 1, share, total: Math.round(((i + 1) * 37.3 * share) % 400 * 100) / 100 + 0.13, full: 100
    }));
  }
  return rows;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Personal Finance Operations';
  wb.created = new Date('2026-07-31T08:00:00Z');

  sheet(wb, 'OMEGA III', SPLIT_COLS, fillerRows(12672404, 'FLEXRA', 12, 11));
  sheet(wb, 'Annuities', SPLIT_COLS, fillerRows(17065592, 'FLEXINV', 8, 23));
  sheet(wb, 'OMEGA I', SPLIT_COLS, fillerRows(13379349, 'FLEXT', 6, 37));
  sheet(wb, 'Flexcube', SPLIT_COLS, fillerRows(17409483, 'FLXCB', 5, 41));

  const si = sheet(wb, 'S&I', [
    ['Assigned', 'assigned', 10], ['Approver', 'approver', 10], ['ContractNumber', 'contractNumber', 15],
    ['BaNCS Product Code', 'bancsProductCode', 19], ['ProductCode', 'productCode', 11],
    ['IntermediaryCode', 'intermediaryCode', 16], ['Product Instance', 'productInstance', 15],
    ['Comm Share', 'commShare', 11], ['Total Commission', 'totalCommission', 16],
    ['ID Number', 'idNumber', 16], ['Declaration Signed Date', 'declarationSignedDate', 22]
  ], seed.worklist);
  // Contract, intermediary and ID numbers are text in the real sheet (Excel flags them with the
  // green "number stored as text" marker); keep them as strings so leading digits survive.
  ['C', 'F', 'J', 'K'].forEach(col => si.getColumn(col).eachCell(c => { c.numFmt = '@'; }));

  wb.views = [{ activeTab: 4, firstSheet: 0 }];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await wb.xlsx.writeFile(OUT);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${seed.worklist.length} S&I rows`);
}

main().catch(err => {
  if (err.code === 'EBUSY' || err.code === 'EPERM') {
    console.error('The work list is open in Excel. Close it and run this again.');
  } else {
    console.error(err);
  }
  process.exit(1);
});
