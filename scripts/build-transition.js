// Writes the synthetic Relationship Transition List (the "PUF and CUF" template from the 4 August 2026 recording,
// 39:30) from seed.transitionList: worklist/Relationship Transition List Aug 2026-synthetic.xlsx, and the same
// as a PDF. Tab 1 is the list as the team receives it, with STATUS and COMMENTS left blank for the agent to fill
// in; tab 2 is the answer key (which book, which benefits, what should happen). Run with `npm run transition`.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const root = path.join(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data-service', 'seed', 'seed.json'), 'utf8'));
const { header: h, rows } = seed.transitionList;
const BASE = 'Relationship Transition List Aug 2026-synthetic';
const OUT = path.join(root, 'worklist', `${BASE}.xlsx`);

// Where each listed policy really lives: its book and its benefits (contract numbers).
const benefitsOf = no => seed.policies.filter(p => p.contractNo === no || p.contractNo.startsWith(no + '/'));
const keyRows = rows.map(r => {
  const b = benefitsOf(r.policyNumber);
  return {
    policyNumber: r.policyNumber, book: b.length ? (b[0].book || 'open') : 'neither',
    benefits: b.map(p => `${p.contractNo} (${p.productName}, ${p.status})`).join('; ') || '-',
    expected: r.expected
  };
});

const COLS = ['IMED_CODE_FROM', 'IMED_CODE_FROM NAME', 'IMED_CODE_TO', 'IMED_CODE_TO NAME', 'NEW ADVISOR PARTY CODE', 'POLICY NUMBERS', 'CLIENT INITIALS', 'CLIENT SURNAME', 'STATUS', 'COMMENTS'];

async function xlsx() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Old Mutual Seek PoC (synthetic data)';
  const ws = wb.addWorksheet('pufs and cufs');
  ws.columns = [14, 24, 14, 24, 22, 18, 10, 18, 16, 40].map(width => ({ width }));
  ws.mergeCells('A1:H1');
  Object.assign(ws.getCell('A1'), { value: 'RELATIONSHIP TRANSITION LIST (synthetic test data)' });
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E8B57' } };
  ws.getRow(1).height = 26;
  const info = [['DATE', h.date], ['NAME OF AREA MANAGER', h.areaManager], ['CELL NUMBER', h.cell], ['Office Number', h.office],
    ['Email Address', h.email], ['ICC Number', h.icc], ['Broker Type', h.brokerType]];
  info.forEach(([k, v], i) => {
    const r = 3 + i;
    ws.getCell(`A${r}`).value = k; ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`E${r}`).value = v;
    ws.getCell(`E${r}`).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  const HEAD = 11;
  ws.getRow(HEAD).values = COLS;
  ws.getRow(HEAD).eachCell(c => {
    c.font = { bold: true }; c.alignment = { wrapText: true, vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  ws.getRow(HEAD).height = 30;
  rows.forEach((r, i) => {
    const row = ws.getRow(HEAD + 1 + i);
    row.values = [r.fromCode, r.fromName, r.toCode, r.toName, r.toPartyCode, r.policyNumber, r.initials, r.surname, '', ''];
    row.eachCell({ includeEmpty: true }, (c, n) => {
      if (n <= COLS.length) c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      if ([1, 3, 6].includes(n)) c.numFmt = '@';
    });
  });
  // STATUS is a dropdown, so the write-back stays consistent.
  for (let i = 0; i < rows.length; i++) {
    ws.getCell(`I${HEAD + 1 + i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Moved,Lapsed,IMED mismatch,Diarised,Not found"'] };
  }
  ws.views = [{ state: 'frozen', ySplit: HEAD }];

  const key = wb.addWorksheet('Expected (test key)');
  key.columns = [{ header: 'POLICY NUMBERS', key: 'policyNumber', width: 18 }, { header: 'BOOK', key: 'book', width: 10 },
    { header: 'BENEFITS (contract numbers in BaNCS)', key: 'benefits', width: 70 }, { header: 'EXPECTED OUTCOME', key: 'expected', width: 90 }];
  key.getRow(1).font = { bold: true };
  keyRows.forEach(r => key.addRow(r));
  key.eachRow(r => r.eachCell(c => { c.alignment = { wrapText: true, vertical: 'top' }; }));
  await wb.xlsx.writeFile(OUT);
  console.log(`wrote ${path.relative(root, OUT)}: ${rows.length} list rows`);
}

async function pdf() {
  const puppeteer = require('puppeteer-core');
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const table = (head, body) => `<table><thead><tr>${head.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
body{font:10px Helvetica,Arial,sans-serif;color:#222;margin:0}h1{font-size:15px;margin:0 0 2px}p.sub{margin:0 0 10px;color:#666}
h2{font-size:13px;margin:0 0 6px;color:#1f4e79}section+section{break-before:page}
dl{display:grid;grid-template-columns:160px 1fr;gap:2px 8px;margin:0 0 10px}dt{font-weight:bold}dd{margin:0}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}
th{background:#1f4e79;color:#fff}tr:nth-child(even) td{background:#f2f6fa}thead{display:table-header-group}tr{break-inside:avoid}
</style><h1>Relationship Transition List: Aug 2026 (synthetic)</h1>
<p class="sub">Synthetic test data for the Old Mutual Seek PoC. No real client names, ID numbers, policies or adviser codes.</p>
<section><h2>pufs and cufs</h2><dl>${[['DATE', h.date], ['NAME OF AREA MANAGER', h.areaManager], ['CELL NUMBER', h.cell], ['Office Number', h.office], ['Email Address', h.email], ['ICC Number', h.icc || '-'], ['Broker Type', h.brokerType]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
${table(COLS, rows.map(r => [r.fromCode, r.fromName, r.toCode, r.toName, r.toPartyCode, r.policyNumber, r.initials, r.surname, '', '']))}</section>
<section><h2>Expected (test key)</h2>${table(['POLICY NUMBERS', 'BOOK', 'BENEFITS (contract numbers in BaNCS)', 'EXPECTED OUTCOME'], keyRows.map(r => [r.policyNumber, r.book, r.benefits, r.expected]))}</section>`;
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const p = await b.newPage();
  await p.setContent(html);
  const out = path.join(root, 'worklist', `${BASE}.pdf`);
  await p.pdf({ path: out, format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await b.close();
  console.log(`wrote ${path.relative(root, out)}`);
}

xlsx().then(pdf).catch(e => { console.error(e); process.exit(1); });
