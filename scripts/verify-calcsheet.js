// Checks the calculation workbook against the running app, so the sheet and BaNCS cannot drift apart:
//   - fees and VAT-exclusive values on the sheet equal what the data service holds
//   - every expected outcome (PROCEED / SKIP / STOP) is what the app does: 56000, ID check, zero fee
//   - for every policy the process changes, zeroing the fee in the app gives the sheet's "after" figures
//   - for every Split Fee row, saving that split in the app stages the sheet's new fee
//   - the Latency Budget uses the figures on the login page
//   - for every policy that can be endorsed, Calculate Premium in the app gives the Quote Summary and EAC sheets' figures
//     (refund, collection, clawback, commission, ongoing %, every EAC component at every milestone)
// Needs the demo running (npm run demo). Resets the data first and last; puts the latency table back.
const path = require('path');
const ExcelJS = require('exceljs');

const DATA = 'http://localhost:4000';
const FILE = path.join(__dirname, '..', 'worklist', 'Fee Switch-Off Calculations.xlsx');
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log(`FAIL  ${msg}`); } else passes++; };
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol;
// A formula cell reads back as { formula, result }. exceljs drops a stored result of exactly 0 when reading
// (the file does hold <v>0</v>), so a formula cell with no result is a zero.
const val = c => { const v = c.value; return v && typeof v === 'object' && 'formula' in v ? ('result' in v ? v.result : 0) : v; };
const api = async (m, u, b) => (await fetch(DATA + u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const names = wb.worksheets.map(w => w.name);
  ok(['README', 'Assumptions', 'Fee Switch-Off', 'Process Checks', 'Split Fee', 'Latency Budget', 'Quote Summary', 'EAC'].every((n, i) => names[i] === n), `sheets: ${names.join(', ')}`);

  const before = await api('GET', '/settings');
  await api('PUT', '/settings/latency', { profile: 'off' });          // API-level run: no waits
  try {
    await api('POST', '/admin/reset');
    const worklist = await api('GET', '/worklist');
    const listId = Object.fromEntries(worklist.map(w => [w.contractNumber, w.idNumber]));
    const declared = Object.fromEntries(worklist.map(w => [w.contractNumber, w.declarationSignedDate]));
    const fee = wb.getWorksheet('Fee Switch-Off'), chk = wb.getWorksheet('Process Checks'), split = wb.getWorksheet('Split Fee'), lat = wb.getWorksheet('Latency Budget');

    // ---- per policy ----
    const rows = [];
    for (let r = 5; fee.getCell(`A${r}`).value; r++) rows.push(r);
    ok(rows.length >= 26, `${rows.length} policies on the sheet`);
    const proceed = [];
    for (const r of rows) {
      const c = String(val(fee.getCell(`A${r}`)));
      const v = await api('GET', `/policies/${c}`);
      ok(near(val(fee.getCell(`G${r}`)), v.fee.vatInclusive, 1e-9) && near(val(fee.getCell(`H${r}`)), v.fee.vatExclusive, 1e-9), `${c}: fee now ${val(fee.getCell(`G${r}`))} / ${val(fee.getCell(`H${r}`))} equals the app's ${v.fee.vatInclusive} / ${v.fee.vatExclusive}`);
      ok(near(val(fee.getCell(`E${r}`)), v.policy.basic.marketValue, 0.005) && near(val(fee.getCell(`F${r}`)), v.policy.contribution.amount, 0.005), `${c}: market value and contribution equal the app's`);
      ok(String(val(chk.getCell(`C${r}`))) === v.policy.owner.idNumber && String(val(chk.getCell(`D${r}`))) === listId[c], `${c}: both ID numbers equal the app's and the work list's`);

      const outcome = String(val(chk.getCell(`K${r}`)));
      const gate = await api('POST', `/policies/${c}/endorse-check`);
      const idMismatch = v.policy.owner.idNumber !== listId[c];
      const expected = idMismatch ? 'STOP' : gate.error ? 'STOP' : v.fee.vatInclusive === 0 ? 'SKIP' : 'PROCEED';
      ok(outcome.startsWith(expected), `${c}: sheet says "${outcome}", the app implies ${expected}${gate.error ? ' (' + gate.error.code + ')' : ''}`);
      if (gate.error) ok(gate.error.code === 56000 && /56000/.test(outcome), `${c}: blocked by 56000 in the app and on the sheet`);
      ok(String(val(fee.getCell(`O${r}`))) === (outcome.startsWith('PROCEED') ? 'Yes' : 'No'), `${c}: "Will the process change it?" agrees with the outcome`);
      if (outcome.startsWith('PROCEED')) proceed.push({ r, c });
    }

    // ---- zero the fee in the app for every policy the sheet says will change ----
    for (const { r, c } of proceed) {
      await api('POST', '/admin/reset');
      const e = await api('POST', `/policies/${c}/endorsements`, { user: 'nzwane', types: ['Change Advisor Details'] });
      if (e.error) { ok(false, `${c}: could not raise an endorsement (${e.error.code})`); continue; }
      const f = await api('PUT', `/policies/${c}/endorsements/${e.serial}/fee`, { user: 'nzwane', vatInclusive: String(val(fee.getCell(`K${r}`))) });
      ok(!f.error && near(f.pendingFee.vatInclusive, val(fee.getCell(`K${r}`)), 1e-9) && near(f.pendingFee.vatExclusive, val(fee.getCell(`L${r}`)), 1e-9), `${c}: the app turns ${val(fee.getCell(`G${r}`))} into ${f.pendingFee && f.pendingFee.vatInclusive} / ${f.pendingFee && f.pendingFee.vatExclusive}, the sheet expects ${val(fee.getCell(`K${r}`))} / ${val(fee.getCell(`L${r}`))}`);
      const sub = (await api('GET', `/policies/${c}/endorsements/${e.serial}`)).submissionView;
      const want = String(val(chk.getCell(`M${r}`)));
      ok((sub.legalVerification === '' && want === 'Select Approved before Submit') || (sub.legalVerification === 'Approved' && want === 'Already Approved'), `${c}: Legal Verification default "${sub.legalVerification || '(blank)'}" gives the action "${want}"`);
      ok(String(val(chk.getCell(`N${r}`))) === declared[c], `${c}: the acceptance date to enter is the work list's declaration date (${declared[c]})`);
    }

    // ---- the Split Fee sheet against the app ----
    const master = await api('GET', '/advisers');
    for (let r = 5; split.getCell(`A${r}`).value; r++) {
      const c = String(val(split.getCell(`A${r}`))), share = Number(val(split.getCell(`F${r}`)));
      await api('POST', '/admin/reset');
      const v = await api('GET', `/policies/${c}`);
      const stay = v.advisers.find(a => a.primary);
      const other = master.find(a => a.partyCode !== stay.partyCode);
      const e = await api('POST', `/policies/${c}/endorsements`, { user: 'nzwane', types: ['Change Advisor Details'] });
      const mk = (cols) => [
        { saleEvent: 'ALL', advisor: stay.partyCode, primary: 'Yes', v: cols(share) },
        { saleEvent: 'ALL', advisor: other.partyCode, primary: 'No', v: cols(100 - share) }];
      const a = await api('PUT', `/policies/${c}/endorsements/${e.serial}/sharing/contribution`, { user: 'nzwane', rows: mk(x => [x, x, x, x]) });
      const b = await api('PUT', `/policies/${c}/endorsements/${e.serial}/sharing/asset`, { user: 'nzwane', rows: mk(x => ['', '', x, x, '', '']) });
      const k = await api('POST', `/policies/${c}/endorsements/${e.serial}/sharing-commit`, { user: 'nzwane' });
      const pf = k.pendingFee;
      ok(!a.error && !b.error && !k.error && pf, `${c} at ${share}%: the split is accepted by the app`);
      if (pf) ok(near(pf.vatInclusive, val(split.getCell(`H${r}`)), 1e-9) && near(pf.vatExclusive, val(split.getCell(`I${r}`)), 1e-9), `${c} at ${share}%: the app stages ${pf.vatInclusive} / ${pf.vatExclusive}, the sheet says ${val(split.getCell(`H${r}`))} / ${val(split.getCell(`I${r}`))}`);
    }

    // ---- Calculate Premium in the app against the Quote Summary and EAC sheets ----
    const qs = wb.getWorksheet('Quote Summary'), ea = wb.getWorksheet('EAC');
    const eaByContract = {};
    for (let r = 5; ea.getCell(`A${r}`).value; r++) (eaByContract[String(val(ea.getCell(`A${r}`)))] = eaByContract[String(val(ea.getCell(`A${r}`)))] || []).push(r);
    let compared = 0;
    for (let r = 5; qs.getCell(`A${r}`).value; r++) {
      const c = String(val(qs.getCell(`A${r}`)));
      await api('POST', '/admin/reset');
      const e = await api('POST', `/policies/${c}/endorsements`, { user: 'nzwane', types: ['Change Advisor Details'] });
      if (e.error) continue;                                  // blocked by 56000: nothing to calculate
      const base = `/policies/${c}/endorsements/${e.serial}`;
      const newFee = Number(val(qs.getCell(`E${r}`)));
      const f = await api('PUT', `${base}/fee`, { user: 'nzwane', vatInclusive: String(newFee) });
      const l = await api('POST', `${base}/actions/create-layer`, { user: 'nzwane' });
      const k = await api('POST', `${base}/actions/calculate-premium`, { user: 'nzwane' });
      if (f.error || l.error || k.error) { ok(false, `${c}: could not reach Calculate Premium (${(f.error || l.error || k.error).code})`); continue; }
      const x = k.calc;
      const want = { refund: 'P', collection: 'Q', clawback: 'S', commission: 'T', premium: 'V', annualBefore: 'F', annualAfter: 'G', monthlyBefore: 'H', monthlyAfter: 'I' };
      for (const [field, col] of Object.entries(want)) ok(near(x[field], val(qs.getCell(`${col}${r}`)), 0.0051), `${c}: ${field} ${x[field]} in the app equals ${val(qs.getCell(`${col}${r}`))} on the sheet`);
      ok(near(x.commissionSummary.ongoingPct, val(qs.getCell(`U${r}`)), 0.0005) && near(x.commissionSummary.immediately, val(qs.getCell(`W${r}`)), 0.0051), `${c}: ongoing commission % and the immediate commission equal the sheet's`);
      ok(x.period.days === val(qs.getCell(`M${r}`)) && x.period.remaining === val(qs.getCell(`O${r}`)), `${c}: fee period ${x.period.days} days, ${x.period.remaining} left, equals the sheet's`);
      const eacRows = eaByContract[c] || [];
      ok(eacRows.length === 4 && x.eac.years.join() === eacRows.map(rr => val(ea.getCell(`C${rr}`))).join(), `${c}: milestones ${x.eac.years.join(', ')} equal the sheet's`);
      eacRows.forEach((rr, i) => {
        const cmp = [['Investment', 'AD'], ['Advice', 'AE'], ['Admin', 'AF'], ['Other', 'AG'], ['EAC', 'AH']];
        const bad = cmp.filter(([name, col]) => !near(x.eac.rows[name][i], val(ea.getCell(`${col}${rr}`)), 0.0101));
        ok(!bad.length, `${c}: EAC at milestone ${i + 1} (${x.eac.years[i]} yrs) ${x.eac.rows.EAC[i]} equals the sheet's ${val(ea.getCell(`AH${rr}`))}${bad.length ? ' (differs on ' + bad.map(b => b[0]).join(', ') + ')' : ''}`);
      });
      compared++;
    }
    ok(compared >= 20, `${compared} policies compared against Calculate Premium in the app`);

    // ---- latency ----
    const now = await api('GET', '/settings');
    let tn = 0, ts = 0;
    for (let i = 0; i < now.steps.length; i++) {
      const st = now.steps[i], r = 5 + i, t = Number(val(lat.getCell(`E${r}`)));
      ok(near(val(lat.getCell(`C${r}`)), st.normal, 0) && near(val(lat.getCell(`D${r}`)), st.stress, 0) && String(val(lat.getCell(`A${r}`))) === st.label, `latency "${st.label}": sheet ${val(lat.getCell(`C${r}`))}/${val(lat.getCell(`D${r}`))} s equals the table's default ${st.normal}/${st.stress}`);
      tn += st.normal * t; ts += st.stress * t;
    }
    ok(near(val(lat.getCell(`F${5 + now.steps.length + 1}`)), tn, 0) && near(val(lat.getCell(`G${5 + now.steps.length + 1}`)), ts, 0), `a full case waits ${tn} s (Normal) and ${ts} s (Stress)`);
  } finally {
    await api('PUT', '/settings/latency', { profile: before.profile, normal: before.normal, stress: before.stress });
    await api('POST', '/admin/reset');
  }
  console.log(`\n${passes} checks passed${fails ? `, ${fails} FAILED` : ''}`);
  console.log(fails ? 'SHEET AND APP DISAGREE' : 'SHEET AND APP AGREE');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
