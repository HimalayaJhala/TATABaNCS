// One command for the whole demo: data-service, mail-sim and bancs-sim, plus the Excel work list and calculation
// workbook if they are missing. Ctrl+C stops both.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const WORKLIST = path.join(root, 'worklist', 'Split Fee Cases and Annuities Jul 2026.xlsx');
if (!fs.existsSync(WORKLIST)) execFileSync(process.execPath, [path.join(__dirname, 'build-worklist.js')], { stdio: 'inherit' });
const CALCSHEET = path.join(root, 'worklist', 'Fee Switch-Off Calculations.xlsx');
if (!fs.existsSync(CALCSHEET)) execFileSync(process.execPath, [path.join(__dirname, 'build-calcsheet.js')], { stdio: 'inherit' });
const procs = [
  ['data-service', 'data-service/server.js', '\x1b[36m'],
  ['mail-sim', 'mail-sim/server.js', '\x1b[32m'],
  ['bancs-sim', 'bancs-sim/server.js', '\x1b[35m'],
  // The closed book: the same BaNCS, its own link (port 4003), login and policies.
  ['bancs-cb', 'bancs-sim/server.js', '\x1b[33m', { BANCS_PORT: '4003', BANCS_BOOK: 'closed' }]
];

const children = procs.map(([name, file, colour, env], i) => {
  const child = spawn(process.execPath, [path.join(root, file)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${colour}[${name}]\x1b[0m `;
  const pipe = stream => stream.on('data', d => String(d).split('\n').filter(Boolean).forEach(l => console.log(prefix + l.replace(/^\[[a-z-]+\] /, ''))));
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', code => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code || 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  children.forEach(c => c.exitCode === null && c.kill());
  setTimeout(() => process.exit(code), 200);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

setTimeout(() => {
  console.log('\nDemo ready:');
  console.log('  Mailbox       http://localhost:4001/mail   (Maker: ?user=nzwane, Checker: ?user=dvisser)');
  console.log(`  Work list     ${path.relative(root, WORKLIST)}`);
  console.log(`  Calculations  ${path.relative(root, CALCSHEET)}`);
  console.log('  BaNCS         http://online.bancs.omapps.net:4002/IIMS/ (or http://localhost:4002/login)');
  console.log('  Closed book   http://online.bancscb.omapps.net:4003/IIMS/ (or http://localhost:4003/login), password Closed@2026');
  console.log('  Latency       per-step table at the top of the BaNCS login page (profile: Off / Normal / Stress)');
  console.log('  Reset         npm run reset (data + work list), Ctrl+Alt+R in BaNCS, or Reset data in the developer menu\n');
}, 600);
