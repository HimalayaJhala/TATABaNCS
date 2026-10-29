// Demo settings that are not part of the dataset, so /admin/reset leaves them alone.
// The only user-facing way to change them is the latency table on the BaNCS login page.
//
// Latency is applied here, on the server, inside the request the browser is waiting on. The
// front end only shows a loader while it waits; it cannot skip, shorten or retry the wait.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'settings.json');
const MAX_SECONDS = 600;

// Where the waits are, as observed in the recording. normal / stress are the default seconds.
const STEPS = [
  { key: 'search', label: 'Policy search → results', observed: 'A few seconds', normal: 2, stress: 6 },
  { key: 'endorseOpen', label: 'Endorse/Alter → initiation screen opens', observed: 'Short', normal: 3, stress: 10 },
  { key: 'endorseSave', label: 'Save on the initiation screen', observed: 'Noticeable', normal: 5, stress: 15 },
  { key: 'basicSave', label: 'Basic Details SAVE', observed: 'Noticeable', normal: 5, stress: 15 },
  { key: 'createLayer', label: 'Create or Refresh Layer', observed: 'The longest single wait, around a minute and a half', normal: 30, stress: 90, hangs: true },
  { key: 'calcPremium', label: 'Calculate Premium', observed: 'Around forty seconds', normal: 25, stress: 75, hangs: true },
  { key: 'endSub', label: 'End Sub Endorsement', observed: 'Around half a minute', normal: 10, stress: 30, hangs: true },
  { key: 'lockEbq', label: 'Lock EBQ', observed: 'Over a minute', normal: 20, stress: 60, hangs: true },
  { key: 'finalise', label: 'Finalise Endorsement', observed: 'Noticeable', normal: 15, stress: 45, hangs: true },
  { key: 'submit', label: 'Endr Quote Submission → Submit', observed: 'Around half a minute', normal: 20, stress: 60 },
  { key: 'activate', label: 'Activate (closed book)', observed: 'Around half a minute', normal: 20, stress: 60 }
];
// Chrome shows its "Page Unresponsive" dialog once a page has ignored input for about 15 seconds, so a freeze has to
// outlast that to be sure of it. 20 s is that with a margin; shorter times can still be typed in (the tests do).
const HANG_DEFAULT = 20;
const PROFILES = ['off', 'normal', 'stress'];

const defaults = () => ({
  profile: 'normal',
  hang: Object.fromEntries(STEPS.map(s => [s.key, false])),
  hangSeconds: Object.fromEntries(STEPS.map(s => [s.key, HANG_DEFAULT])),   // how long a step freezes the browser when its hang is Yes
  normal: Object.fromEntries(STEPS.map(s => [s.key, s.normal])),
  stress: Object.fromEntries(STEPS.map(s => [s.key, s.stress]))
});

let settings = defaults();
try {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (PROFILES.includes(saved.profile) && saved.normal && saved.stress) {
    // An older file kept one switch for the five quote-build steps; it becomes one boolean per step.
    const hang = typeof saved.hang === 'object' && saved.hang ? saved.hang : Object.fromEntries(STEPS.map(s => [s.key, saved.hang === true && !!s.hangs]));
    settings = { profile: saved.profile, hang: { ...settings.hang, ...hang }, hangSeconds: { ...settings.hangSeconds, ...(saved.hangSeconds || {}) }, normal: { ...settings.normal, ...saved.normal }, stress: { ...settings.stress, ...saved.stress } };
  }
} catch (e) { /* first run, or an older settings file: start from the table defaults */ }

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
}

const known = key => STEPS.some(s => s.key === key);
// A step with Browser hang = Yes has no server wait at all: the page itself is frozen for the step's hang time (see
// hangMs and bancs.js) and only then sends the request. Every other step waits per the profile.
const seconds = key => {
  if (settings.hang[key]) return 0;
  return settings.profile === 'off' ? 0 : Number(settings[settings.profile][key]) || 0;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  STEPS, PROFILES, MAX_SECONDS,
  known,
  get: () => ({ profile: settings.profile, hang: { ...settings.hang }, hangSeconds: { ...settings.hangSeconds }, normal: { ...settings.normal }, stress: { ...settings.stress }, steps: STEPS }),
  seconds,
  // The steps the browser freezes on while it waits, with how long (ms): the steps whose hang boolean is true,
  // for their own hang time. The page blocks its own main thread for that long, so Chrome shows its native
  // "Page Unresponsive" dialog; nothing in the page draws it.
  hangMs() {
    return Object.fromEntries(STEPS.filter(st => settings.hang[st.key]).map(st => [st.key, Math.round((Number(settings.hangSeconds[st.key]) || 0) * 1000)]).filter(([, ms]) => ms > 0));
  },
  // Wait out the configured time for a step. Resolves with the milliseconds waited.
  async wait(key) {
    const ms = Math.round(seconds(key) * 1000);
    if (ms > 0) await sleep(ms);
    return ms;
  },
  // body: { profile, normal: {key: seconds}, stress: {key: seconds} } or { reset: true }. Returns an error text or null.
  update(body) {
    if (body && body.reset) { settings = defaults(); save(); return null; }
    const next = { profile: settings.profile, hang: { ...settings.hang }, hangSeconds: { ...settings.hangSeconds }, normal: { ...settings.normal }, stress: { ...settings.stress } };
    const yes = v => v === true || v === 'true' || v === 'Yes';
    if (body.hang !== undefined) {
      if (typeof body.hang === 'object' && body.hang) {
        for (const [key, v] of Object.entries(body.hang)) {
          if (!known(key)) return `Unknown step ${key}.`;
          next.hang[key] = yes(v);
        }
      } else for (const st of STEPS) next.hang[st.key] = yes(body.hang);   // one value for every step
    }
    if (body.profile !== undefined) {
      if (!PROFILES.includes(body.profile)) return `Profile must be one of ${PROFILES.join(', ')}.`;
      next.profile = body.profile;
    }
    for (const which of ['normal', 'stress', 'hangSeconds']) {
      for (const [key, raw] of Object.entries(body[which] || {})) {
        if (!known(key)) return `Unknown step ${key}.`;
        const n = Number(String(raw).trim());
        if (String(raw).trim() === '' || !Number.isFinite(n) || n < 0 || n > MAX_SECONDS) {
          const label = STEPS.find(s => s.key === key).label;
          return `${label} (${which === 'hangSeconds' ? 'client latency' : which}): enter a number of seconds between 0 and ${MAX_SECONDS}.`;
        }
        next[which][key] = Math.round(n * 10) / 10;
      }
    }
    settings = next;
    save();
    return null;
  }
};
