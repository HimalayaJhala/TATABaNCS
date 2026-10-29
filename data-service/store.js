// In-memory state loaded from the seed, persisted to data/state.json after every write so a
// restart mid-demo keeps its place. The seed file is only ever read.
const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, 'seed', 'seed.json');
const STATE = path.join(__dirname, 'data', 'state.json');

let state;

function load() {
  const src = fs.existsSync(STATE) ? STATE : SEED;
  state = JSON.parse(fs.readFileSync(src, 'utf8'));
  state.mail = state.mail || [];     // state saved before the mailbox existed
}

function save() {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

function reset() {
  state = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  save();
}

load();

module.exports = {
  get: () => state,
  save,
  reset
};
