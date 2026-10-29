// The mailbox behind the simulated email. Three kinds of message move the case between the two personas:
//   case      the work list arrives with the contract to process  -> the Maker (capturer)
//   verify    the Maker has submitted; please verify it           -> the Checker (verifier)
//   approved  the Checker has activated it                        -> the Maker
// Messages hold structure only (who, which contract, which quote); the mail app builds the text from live data.
const store = require('./store');

const SENDER = { name: 'Thandi Mokoena', title: 'Team Leader, ADAC, Personal Finance Operations' };
const pad = n => String(n).padStart(2, '0');

function box() { const s = store.get(); s.mail = s.mail || []; return s.mail; }
function userOf(kind) { return store.get().users.find(u => u.kind === kind); }
function stamp() { const d = new Date(); return { date: store.get().config.systemDate, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; }
function nextId() { return 'm' + (box().reduce((m, x) => Math.max(m, Number(x.id.slice(1))), 0) + 1); }

function push(msg) {
  const m = { id: nextId(), read: false, sentAt: stamp(), ...msg };
  box().push(m);
  store.save();
  return m;
}

module.exports = {
  list: userId => box().filter(m => m.to === userId).sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1))),
  get: id => box().find(m => m.id === id) || null,
  markRead(id) { const m = box().find(x => x.id === id); if (m) { m.read = true; store.save(); } return m; },

  // The work list arrives for one contract. Returns null if the contract is not on the work list.
  deliverCase(contractNo) {
    const row = (store.get().worklist || []).find(w => w.contractNumber === contractNo);
    const maker = userOf('capturer');
    if (!row || !maker) return null;
    return push({
      to: maker.id, from: SENDER, kind: 'case', contractNo, attachment: true,
      subject: `FW: Scale to zero SOP, fee switch-off for contract ${contractNo}`
    });
  },

  // Called by the rules when a quote is submitted or activated.
  notify(kind, e) {
    const checker = userOf('verifier'), maker = store.get().users.find(u => u.id === e.submittedBy) || userOf('capturer');
    if (kind === 'verify' && checker) {
      return push({ to: checker.id, from: { name: maker.name, title: `${maker.role}, Personal Finance Operations` }, kind: 'verify', contractNo: e.contractNo, serial: e.serial, attachment: false,
        subject: `Please verify: endorsement ${e.quotationNumber} for contract ${e.contractNo}` });
    }
    if (kind === 'approved' && maker) {
      return push({ to: maker.id, from: { name: (store.get().users.find(u => u.id === e.activatedBy) || checker).name, title: 'PREM-ADM, Personal Finance Operations' }, kind: 'approved', contractNo: e.contractNo, serial: e.serial, attachment: false,
        subject: `Approved: endorsement ${e.quotationNumber} for contract ${e.contractNo}` });
    }
    return null;
  }
};
