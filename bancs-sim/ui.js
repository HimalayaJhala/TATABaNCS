// Markup helpers. Every control sits inside a parent block with a stable id and a data-block
// attribute, so a DAP flow can select the element itself or its whole block:
//
//   screen  > section > field            > field-control > input
//   screen  > grid-block > table > row
//   screen  > button-bar > button
//
// Block ids are built from the control's own id (field-<id>, control-<id>), so they never depend on
// position and do not shift when a screen gains or loses a field.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function attrs(o) {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
    .join(' ');
}

function input({ id, name, value = '', readonly, cls, type = 'text', title, placeholder, maxlength, num, date, disabled } = {}) {
  const c = [cls, num && 'num', date && 'date'].filter(Boolean).join(' ');
  return `<input ${attrs({ type, id, name, class: c || undefined, value, readonly, disabled, title, placeholder, maxlength, autocomplete: date ? 'off' : undefined })}>`;
}

// options: ['A', 'B'] or [['value', 'Label'], ...]. selected is compared to the value.
function select({ id, name, options = [], selected, disabled, cls, title, data } = {}) {
  const opts = options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option ${attrs({ value: v, selected: String(v) === String(selected ?? '') })}>${esc(l)}</option>`;
  }).join('');
  return `<select ${attrs({ id, name, class: cls, disabled, title, ...(data || {}) })}>${opts}</select>`;
}

function textarea({ id, name, value = '', readonly, maxlength, cls } = {}) {
  return `<textarea ${attrs({ id, name, readonly, maxlength, class: cls })}>${esc(value)}</textarea>`;
}

const cal = () => '<span class="cal" title="Choose a date"></span>';
const lookup = id => `<span class="lookup" ${attrs({ id })}></span>`;

// One labelled field. `control` is the control's HTML (from the helpers above, or a button, a dual list...).
function field({ id, label, mandatory, control, hidden, cls, labelFor } = {}) {
  const key = id || String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `<div ${attrs({ class: ['field', cls].filter(Boolean).join(' '), id: `field-${key}`, 'data-block': 'field', 'data-field': key, hidden })}>` +
    `<label class="field-label" for="${esc(labelFor || id || '')}">${esc(label)}</label>` +
    `<span class="field-mark">${mandatory ? '*' : ''}</span>` +
    `<div class="field-control" id="control-${esc(key)}" data-block="field-control">${control || ''}</div></div>`;
}

// Keeps a two-column grid aligned where a row has only one field.
const blank = () => '<div class="field blank" data-block="spacer" aria-hidden="true"></div>';

module.exports = { esc, attrs, input, select, textarea, cal, lookup, field, blank };
