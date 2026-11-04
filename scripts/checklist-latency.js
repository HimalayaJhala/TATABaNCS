// Tests that step latency is served by the data API and that the record is saved after the wait, not before.
// It calls data-service directly (no browser), with short waits, through the SOP chain:
//   Endorse/Alter -> Basic Details Save -> Acceptance -> Create or Refresh Layer -> Calculate Premium ->
//   End Sub Endorsement -> Lock EBQ -> Finalise Endorsement.
// For every timed step it checks that
//   - the response takes the configured time and says so in X-Latency-Waited-Ms,
//   - the record is unchanged part-way through the wait and changed once the response is back,
//   - the next step is refused at once part-way through (it is only unlocked by the save), and works afterwards.
// Also: the fee switch-off counter counts a contract once the Maker has submitted it with a zero fee; a refused step answers at once and changes nothing; the Checker never waits.
// Usage: npm run test:latency (needs the demo running). Resets the data and restores the latency table at the end.
const DATA = 'http://localhost:4000', C = '119900001001', MAKER = 'nzwane', CHECKER = 'dvisser';
const WAIT = { endorseSave: 2, basicSave: 1, createLayer: 2, calcPremium: 2, endSub: 1, lockEbq: 1, finalise: 1, submit: 1 };   // seconds
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One call, with how long the response took and the wait the API reports.
async function call(method, url, body) {
  const t = Date.now();
  const res = await fetch(DATA + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  return { data, error: data && data.error, ms: Date.now() - t, waited: Number(res.headers.get('x-latency-waited-ms')) || 0 };
}
const summary = async serial => (await call('GET', `/policies/${C}/endorsements/${serial}`)).data;

// Runs `step` and, part-way through its wait, takes `probe`. Returns the step's result and what the probe saw.
async function during(ms, step, probe) {
  const running = step();
  await sleep(ms * 0.4);
  const seen = await probe();
  return { result: await running, seen };
}

(async () => {
  const before = (await call('GET', '/settings')).data;
  const restore = () => call('PUT', '/settings/latency', { profile: before.profile, hang: before.hang, hangSeconds: before.hangSeconds, normal: before.normal, stress: before.stress });
  try {
    await call('POST', '/admin/reset');
    ok((await call('PUT', '/settings/latency', { profile: 'normal', hang: false, normal: WAIT })).data.profile === 'normal', 'latency set to short Normal waits');

    // Endorse/Alter Save: the quote does not exist until the wait is over.
    const count = async () => (await call('GET', `/policies/${C}/endorsements`)).data.length;
    const n0 = await count();
    const made = await during(WAIT.endorseSave * 1000,
      () => call('POST', `/policies/${C}/endorsements`, { user: MAKER, types: ['Change Asset Advice Fee'] }),
      async () => await count());
    const serial = made.result.data.serial || made.result.data.id;
    ok(made.seen === n0 && (await count()) === n0 + 1, `Endorse/Alter Save: no quote part-way through (${made.seen} of ${n0}), saved after (${n0 + 1})`);
    ok(made.result.ms >= WAIT.endorseSave * 1000 - 100 && made.result.ms < WAIT.endorseSave * 1000 + 1500 && made.result.waited === WAIT.endorseSave * 1000, `Endorse/Alter Save took ${made.result.ms} ms and reported ${made.result.waited} ms`);

    // Basic Details Save: the fee is staged only after the wait.
    const fee = await during(WAIT.basicSave * 1000,
      () => call('PUT', `/policies/${C}/endorsements/${serial}/fee`, { user: MAKER, vatInclusive: '0' }),
      async () => (await summary(serial)).pendingFee);
    ok(fee.seen === null && (await summary(serial)).pendingFee.vatInclusive === 0, 'Basic Details Save: the new fee is not staged part-way through, and is after the wait');
    ok(fee.result.waited === WAIT.basicSave * 1000 && fee.result.ms >= WAIT.basicSave * 1000 - 100, `Basic Details Save took ${fee.result.ms} ms`);
    ok((await call('PUT', `/policies/${C}/endorsements/${serial}/acceptance`, { user: MAKER, accepted: 'Yes', date: '04/11/2026' })).ms < 800, 'Acceptance Save has no latency row and answers at once');

    // The quote-build chain: each step's save is what unlocks the next.
    const chain = [
      ['create-layer', 'createLayer', 'layer', 'calculate-premium'],
      ['calculate-premium', 'calcPremium', 'premium', 'end-sub-endorsement'],
      ['end-sub-endorsement', 'endSub', 'subEnded', 'lock-ebq'],
      ['lock-ebq', 'lockEbq', 'locked', 'finalise'],
      ['finalise', 'finalise', 'finalised', null]
    ];
    const act = (a, user = MAKER) => call('POST', `/policies/${C}/endorsements/${serial}/actions/${a}`, { user });
    let stage = (await summary(serial)).stage;
    for (const [action, key, expect, next] of chain) {
      const ms = WAIT[key] * 1000;
      const run = await during(ms, () => act(action), async () => ({
        stage: (await summary(serial)).stage,
        next: next ? await act(next) : null          // the next step, tried while this one is still running
      }));
      ok(run.seen.stage === stage, `${action}: still "${stage}" part-way through the wait`);
      if (next) ok(run.seen.next.error && /^304\d\d$/.test(String(run.seen.next.error.code)) && run.seen.next.ms < 500, `${action}: ${next} is refused at once while it runs (${run.seen.next.error && run.seen.next.error.code} in ${run.seen.next.ms} ms)`);
      ok(!run.result.error && run.result.waited === ms && run.result.ms >= ms - 100 && run.result.ms < ms + 1500, `${action}: took ${run.result.ms} ms, reported ${run.result.waited} ms, configured ${ms} ms`);
      stage = (await summary(serial)).stage;
      ok(stage === expect, `${action}: saved after the wait, stage is now "${stage}"`);
    }

    // A refused step (here, one on the finalised quote) answers at once and changes nothing, even with a long wait configured.
    const again = await act('create-layer');
    ok(again.error && again.error.code === 30406 && again.ms < 500 && again.waited === 0 && (await summary(serial)).stage === 'finalised', `a step on a finalised quote is refused at once (${again.error && again.error.code} in ${again.ms} ms) and the quote is unchanged`);

    // The Checker never waits; neither does a call that names no user.
    const chk = await act('create-layer', CHECKER);
    ok(chk.error && chk.error.code === 71037 && chk.ms < 500 && chk.waited === 0, `the Checker is refused at once (${chk.error && chk.error.code} in ${chk.ms} ms)`);
    await call('PUT', '/settings/latency', { normal: { search: 2 } });
    const sMaker = await call('GET', `/policies?contractNo=${C}&user=${MAKER}`);
    const sChecker = await call('GET', `/policies?contractNo=${C}&user=${CHECKER}`);
    const sAnon = await call('GET', `/policies?contractNo=${C}`);
    ok(sMaker.waited === 2000 && sMaker.ms >= 1900 && sMaker.data.length === 1, `search waits for the Maker (${sMaker.ms} ms)`);
    ok(sChecker.waited === 0 && sChecker.ms < 500 && sAnon.waited === 0 && sAnon.ms < 500, 'search does not wait for the Checker, or for a call with no user');

    // The switch-off counter ties to the Maker's Submit of the final endorsement, not to the Checker's Activate.
    const prog = async () => (await call('GET', '/fee-zero/progress')).data;
    const p0 = await prog();
    ok(p0.status === 'idle' && p0.done === 0, `a finalised quote with a zero fee is not counted before Submit (${p0.status}, ${p0.done} of ${p0.target})`);
    const subBody = { user: MAKER, reinsuranceVerified: 'Yes', allAdminRequirementsReceived: 'Accepted', legalVerification: 'Approved' };
    const sub = await during(WAIT.submit * 1000, () => call('POST', `/policies/${C}/endorsements/${serial}/submit`, subBody), async () => (await prog()).done);
    ok(!sub.result.error && sub.seen === 0, `Submit: not counted part-way through its wait (${sub.seen})${sub.result.error ? ' ' + sub.result.error.message : ''}`);
    const p1 = await prog();
    ok(p1.done === 1 && p1.status === 'running' && p1.pending.indexOf(C) < 0, `after Submit the contract counts and tracking has started, with no Activate (${p1.done} of ${p1.target}, ${p1.status})`);
    const rej = await call('POST', `/policies/${C}/endorsements/${serial}/reject`, { user: CHECKER });
    ok(!rej.error && (await prog()).done === 0, 'if the Checker rejects the submitted quote, it stops counting');

    // Latency Off: no wait anywhere.
    await call('PUT', '/settings/latency', { profile: 'off' });
    const off = await call('GET', `/policies?contractNo=${C}&user=${MAKER}`);
    ok(off.waited === 0 && off.ms < 500, `profile Off: no wait (${off.ms} ms)`);
  } finally {
    await restore();
    await call('POST', '/admin/reset');
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
