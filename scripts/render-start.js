// Start command on Render: data-service on its usual internal port and the open-book BaNCS on the port Render
// gives the service ($PORT), so the site keeps exactly the paths it has locally. No mailbox and no closed book
// (run `npm run demo` for those). If either process exits, both stop and Render restarts the service.
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const procs = [
  ['data-service', 'data-service/server.js', {}],
  ['bancs-sim', 'bancs-sim/server.js', { BANCS_PORT: process.env.PORT || '4002' }]
];

const children = procs.map(([name, file, env]) => {
  const child = spawn(process.execPath, [path.join(root, file)], { env: { ...process.env, ...env }, stdio: 'inherit' });
  child.on('exit', code => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown(code || 1);
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
