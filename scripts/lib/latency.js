// Sets the latency the way a person does: with the table on the login page. Returns a function that
// puts the whole previous table (profile and every figure) back.
const B = 'http://localhost:4002', DATA = 'http://localhost:4000';

async function applyLatency(browser, { profile, hang, hangSeconds = {}, normal = {}, stress = {} }) {
  const before = await (await fetch(DATA + '/settings')).json();
  const page = await browser.newPage();
  await page.goto(B + '/login');
  await page.click('#btn-dev-menu');                                   // the developer menu starts hidden
  await page.waitForSelector('#demo-controls', { visible: true });
  await page.$eval('#latency-panel', d => { d.open = true; });   // and its latency table starts closed
  for (const [which, vals] of [['normal', normal], ['stress', stress], ['hang', hangSeconds]]) {
    for (const [key, v] of Object.entries(vals)) {
      await page.$eval(which === 'hang' ? `#hang-seconds-${key}` : `#latency-${which}-${key}`, (e, val) => { e.value = String(val); }, v);
    }
  }
  if (profile) await page.select('#latency-profile', profile);
  if (hang !== undefined) {   // true / false for every step, or { step: true } for chosen ones
    await page.$eval('#latency-panel', d => { d.open = true; });
    const keys = await page.$$eval('[id^="browser-hang-"]', es => es.map(e => e.id.replace('browser-hang-', '')));
    for (const k of keys) { const on = typeof hang === 'object' ? !!hang[k] : !!hang; await page.select('#browser-hang-' + k, on ? 'Yes' : 'No'); }
  }
  await Promise.all([page.waitForNavigation(), page.click('#btn-latency-apply')]);
  await page.close();
  return () => applyLatency(browser, { profile: before.profile, hang: before.hang, hangSeconds: before.hangSeconds, normal: before.normal, stress: before.stress }).then(() => {});
}

const setProfile = (browser, profile) => applyLatency(browser, { profile });

module.exports = { applyLatency, setProfile };
