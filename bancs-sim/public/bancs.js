// The minimum JavaScript BaNCS needs: the dual list box in the
// Endorsement Initiation modal, the loading state and browser hang on slow steps, and the demo reset shortcut. No business rules live here.
(function () {
  // Dual list box on the Endorsement Initiation Screen.
  function move(from, to) {
    var src = document.getElementById(from), dst = document.getElementById(to);
    if (!src || !dst) return;
    Array.prototype.slice.call(src.selectedOptions).forEach(function (o) {
      if (o.disabled) return;
      o.selected = false;
      dst.appendChild(o);
    });
  }
  var r = document.getElementById('btn-move-right'), l = document.getElementById('btn-move-left');
  if (r) r.addEventListener('click', function () { move('endorsement-types-available', 'endorsement-types-selected'); });
  if (l) l.addEventListener('click', function () { move('endorsement-types-selected', 'endorsement-types-available'); });
  var ef = document.getElementById('form-endorsement-initiation');
  if (ef) ef.addEventListener('submit', function () {
    var sel = document.getElementById('endorsement-types-selected');
    Array.prototype.forEach.call(sel.options, function (o) { o.selected = true; });
  });

  // Loading. The wait itself happens on the server (data-service); this only shows the loading state, which is
  // the recording's: the sections drop away and a dotted ring spins under the header (see body.is-loading in
  // the stylesheet). It appears for forms marked data-busy, or when the submitting button is (Submit and
  // Activate share a form with Save).
  //
  // Browser hang (developer menu): a step set to Yes carries data-hang-ms. On submit the page holds the request
  // back, shows the loading state, then blocks its own main thread for that long with a plain busy loop (nothing
  // else is in flight, so Chrome sees a page that ignores input) and only afterwards sends the request. Chrome
  // shows its native "Page Unresponsive" dialog if you click while it is stuck; nothing here draws that dialog.
  function freeze(ms) { var end = Date.now() + ms; while (Date.now() < end) { /* busy */ } }
  document.addEventListener('submit', function (ev) {
    var f = ev.target, sub = ev.submitter;
    if (!(f.hasAttribute && f.hasAttribute('data-busy')) && !(sub && sub.hasAttribute('data-busy'))) return;
    if (f.__hung) return;                                                   // second pass, after the freeze: let it through
    document.body.classList.add('is-loading');
    var ms = parseInt((sub && sub.getAttribute('data-hang-ms')) || f.getAttribute('data-hang-ms') || '0', 10);
    if (!(ms > 0)) return;
    ev.preventDefault();
    setTimeout(function () {                                                // let the loading state paint first
      freeze(ms);
      f.__hung = true;
      if (f.requestSubmit) f.requestSubmit(sub || undefined); else f.submit();
    }, 150);
  });

  // Endorsement Initiation modal: Later Effective Date = Yes reveals the date field, and the
  // Requester Party list follows the Requester Stake Code.
  var later = document.getElementById('later-effective-date');
  if (later) later.addEventListener('change', function () {
    var row = document.getElementById('field-later-effective-date-value');
    if (row) row.hidden = later.value !== 'Yes';
  });
  var stake = document.getElementById('requester-stake-code'), party = document.getElementById('requester-party');
  if (stake && party) stake.addEventListener('change', function () {
    var list = JSON.parse(party.getAttribute('data-parties'))[stake.value] || [];
    party.innerHTML = '';
    list.forEach(function (name) { var o = document.createElement('option'); o.textContent = name; party.appendChild(o); });
  });

  // Date picker for every input.date (and its calendar icon). Dates are DD/MM/YYYY, as BaNCS shows them.
  (function () {
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var re = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var fmt = function (d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
    var parse = function (v) {
      var m = re.exec((v || '').trim());
      if (!m) return null;
      var d = new Date(+m[3], +m[2] - 1, +m[1]);
      return d.getFullYear() === +m[3] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[1] ? d : null;
    };
    var sysDate = parse(document.body.getAttribute('data-system-date')) || new Date();
    var pop = null, target = null, view = null;

    function close() { if (pop) { pop.remove(); pop = null; target = null; } }

    function render() {
      var sel = parse(target.value), first = new Date(view.getFullYear(), view.getMonth(), 1);
      var start = new Date(first); start.setDate(1 - first.getDay());
      var h = '<div class="dp-head"><button type="button" data-nav="-1" title="Previous month">&lsaquo;</button>' +
        '<select class="dp-month" id="dp-month">' + MONTHS.map(function (n, i) { return '<option value="' + i + '"' + (i === view.getMonth() ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
        '<select id="dp-year">' + (function () { var o = '', y0 = view.getFullYear(); for (var y = y0 - 60; y <= y0 + 20; y++) o += '<option' + (y === y0 ? ' selected' : '') + '>' + y + '</option>'; return o; })() + '</select>' +
        '<button type="button" data-nav="1" title="Next month">&rsaquo;</button></div><div class="dp-grid">' +
        ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(function (d) { return '<span class="dow">' + d + '</span>'; }).join('');
      for (var i = 0; i < 42; i++) {
        var d = new Date(start); d.setDate(start.getDate() + i);
        var cls = 'day' + (d.getMonth() !== view.getMonth() ? ' other' : '') + (fmt(d) === fmt(sysDate) ? ' today' : '') + (sel && fmt(d) === fmt(sel) ? ' sel' : '');
        h += '<span class="' + cls + '" data-date="' + fmt(d) + '">' + d.getDate() + '</span>';
      }
      pop.innerHTML = h + '</div><div class="dp-foot"><button type="button" data-today="1">Today</button><button type="button" data-clear="1">Clear</button></div>';
    }

    function open(input) {
      if (input.readOnly || input.disabled) return;
      if (target === input && pop) return;
      close();
      target = input;
      view = parse(input.value) || new Date(sysDate);
      view = new Date(view.getFullYear(), view.getMonth(), 1);
      pop = document.createElement('div');
      pop.className = 'dp'; pop.id = 'date-picker';
      document.body.appendChild(pop);
      render();
      var r = input.getBoundingClientRect(), top = r.bottom + 2;
      if (top + pop.offsetHeight > window.innerHeight) top = Math.max(4, r.top - pop.offsetHeight - 2);
      pop.style.top = top + 'px';
      pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4)) + 'px';
    }

    function choose(value) {
      target.value = value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    }

    document.addEventListener('focusin', function (ev) { if (ev.target.matches && ev.target.matches('input.date')) open(ev.target); });
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.matches && t.matches('input.date')) { open(t); return; }
      if (t.classList && t.classList.contains('cal')) {
        var inp = t.previousElementSibling;
        if (inp && inp.matches('input.date')) { inp.focus(); open(inp); }
        return;
      }
      if (!pop) return;
      if (!pop.contains(t)) { close(); return; }
      if (t.dataset.date) choose(t.dataset.date);
      else if (t.dataset.today) choose(fmt(sysDate));
      else if (t.dataset.clear) choose('');
      else if (t.dataset.nav) { view = new Date(view.getFullYear(), view.getMonth() + (+t.dataset.nav), 1); render(); }
    });
    document.addEventListener('change', function (ev) {
      if (!pop || (ev.target.id !== 'dp-month' && ev.target.id !== 'dp-year')) return;
      view = new Date(+document.getElementById('dp-year').value, +document.getElementById('dp-month').value, 1);
      render();
    });
    document.addEventListener('input', function (ev) {          // a fully typed valid date closes the picker
      if (ev.target === target && parse(target.value)) { var v = parse(target.value); view = new Date(v.getFullYear(), v.getMonth(), 1); close(); }
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' || ev.key === 'Tab') close(); });
    window.addEventListener('scroll', function (ev) { if (pop && !pop.contains(ev.target)) close(); }, true);
    window.addEventListener('resize', close);
    window.addEventListener('pageshow', close);
  })();

  // The menu can be longer than the window; keep the active item in view.
  var activeNav = document.querySelector('#left-nav li.active');
  if (activeNav) {
    var menu = document.getElementById('left-nav');
    var top = activeNav.offsetTop, bottom = top + activeNav.offsetHeight;
    if (top < menu.scrollTop || bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = Math.max(0, top - menu.clientHeight / 2);
  }

  // Back/forward can restore a page from cache with the overlay still showing; hide it again.
  window.addEventListener('pageshow', function () { document.body.classList.remove('is-loading'); });

  // Developer menu (login page): the bug button opens and closes the pop-over; Esc or a click outside closes it.
  (function () {
    var btn = document.getElementById('btn-dev-menu'), panel = document.getElementById('demo-controls');
    if (!btn || !panel) return;
    function set(open) { panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); set(panel.hidden); });
    document.addEventListener('click', function (ev) { if (!panel.hidden && !panel.contains(ev.target)) set(false); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !panel.hidden) { set(false); btn.focus(); } });
    window.addEventListener('pageshow', function () { set(false); });
  })();

  // Developer tools, Google Sheets: copy an IMPORTDATA formula for the work list's CSV, then let the link open a new
  // sheet. Pasting the formula into A1 loads the data. IMPORTDATA turns dd/mm/yyyy into a bare serial (46238), so
  // whole numbers in the 2000-2049 date range are written back as dd/mm/yyyy; no code or amount in the lists falls there.
  Array.prototype.forEach.call(document.querySelectorAll('[data-gsheet]'), function (a) {
    a.addEventListener('click', function () {
      var formula = '=MAP(IMPORTDATA("' + a.getAttribute('data-gsheet') + '", ",", "en_GB"), LAMBDA(x, IF(AND(ISNUMBER(x), x >= 36526, x <= 54789, x = INT(x)), TEXT(x, "dd/mm/yyyy"), x)))';
      var status = document.getElementById('gsheet-status');
      var done = function () { if (status) status.textContent = 'Formula copied. In the new Google Sheet, click cell A1 and paste (Ctrl+V / Cmd+V).'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(formula).then(done, function () { window.prompt('Copy this formula into cell A1 of the new sheet:', formula); });
      else window.prompt('Copy this formula into cell A1 of the new sheet:', formula);
    });
  });

  // Demo control: Ctrl+Alt+R restores the dataset.
  document.addEventListener('keydown', function (ev) {
    if (ev.ctrlKey && ev.altKey && (ev.key === 'r' || ev.key === 'R' || ev.code === 'KeyR')) {
      if (!confirm('Reset the demo dataset to the seed?')) return;
      var f = document.createElement('form');
      f.method = 'POST';
      f.action = '/admin/reset';
      document.body.appendChild(f);
      f.submit();
    }
  });
})();
