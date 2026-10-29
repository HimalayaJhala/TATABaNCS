// mail-sim (port 4001): the Maker's and the Checker's mailboxes. A small Outlook-style inbox over the mail
// held in data-service. The case email carries the work list as an attachment (downloadable, and previewed in
// the message); the hand-off emails between the two personas arrive as the case moves through BaNCS.
const path = require('path');
const express = require('express');

const PORT = Number(process.env.MAIL_PORT || 4001);
const DATA = process.env.DATA_URL || 'http://localhost:4000';
const BANCS = process.env.BANCS_URL || 'http://localhost:4002';
const SHEET = path.join(__dirname, '..', 'worklist', 'Split Fee Cases and Annuities Jul 2026.xlsx');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => { if (!req.path.startsWith('/static')) res.set('Cache-Control', 'no-store'); next(); });
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.ico')));

const api = async (method, url) => (await fetch(DATA + url, { method })).json();
const PERSONA = { nzwane: { role: 'Maker', cls: 'maker' }, dvisser: { role: 'Checker', cls: 'checker' } };

// Everything a message body needs, read live so it always matches BaNCS.
async function context(m) {
  const [pol, worklist] = await Promise.all([api('GET', `/policies/${m.contractNo}`), api('GET', '/worklist')]);
  const row = worklist.find(w => w.contractNumber === m.contractNo) || {};
  const quote = m.serial ? (pol.endorsements || []).find(e => e.serial === m.serial) : null;
  return { pol, row, worklist, quote };
}

async function render(res, view, locals) {
  res.render(view, { bancs: BANCS, personas: PERSONA, ...locals });
}

app.get('/', (req, res) => res.redirect('/mail'));

// Inbox. ?user=nzwane (Maker, the default) or dvisser (Checker); ?open=<id> shows a message in the reading pane.
app.get('/mail', async (req, res) => {
  const userId = PERSONA[req.query.user] ? req.query.user : 'nzwane';
  const users = await api('GET', '/users');
  const me = users.find(u => u.id === userId);
  const messages = await api('GET', `/mail?to=${userId}`);
  const open = messages.find(m => m.id === req.query.open) || null;
  let body = null;
  if (open) { await api('POST', `/mail/${open.id}/read`); open.read = true; body = await context(open); }
  const unread = messages.filter(m => !m.read).length;
  await render(res, 'inbox', { me, userId, messages, open, ctx: body, unread, title: `Inbox${unread ? ` (${unread})` : ''}` });
});

// The attachment: the work list workbook the cases come from.
app.get('/attachment/:id', async (req, res) => {
  const m = await api('GET', `/mail/${req.params.id}`);
  if (m.error || !m.attachment) return res.status(404).send('No attachment');
  res.download(SHEET, 'Split Fee Cases and Annuities Jul 2026.xlsx');
});

app.use((err, req, res, next) => { console.error(err); res.status(500).send(`<pre>Mail error: ${err.message}</pre>`); });
app.listen(PORT, () => console.log(`[mail-sim] listening on http://localhost:${PORT}`));
