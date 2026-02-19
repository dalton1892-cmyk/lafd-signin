/* ══════════════════════════════════════════════════
   LAFD Sign-In Sheet — app.js
   All state is persisted in localStorage.
══════════════════════════════════════════════════ */

// ─── DEFAULT CONFIG ────────────────────────────────
const DEFAULT_DROPDOWNS = [
  { id: 'program',    label: 'Program Name',    options: ['Fire Safety 101', 'Fire Explorer', 'Youth Academy', 'Community Outreach', 'CERT Training'] },
  { id: 'location',   label: 'Location',        options: ['Station 1', 'Station 5', 'Station 12', 'Community Center', 'School Site'] },
  { id: 'instructor', label: 'Instructor',       options: ['Captain Garcia', 'Engineer Reyes', 'FF Thompson', 'Lt. Martinez'] },
  { id: 'session',    label: 'Session / Class',  options: ['Session 1', 'Session 2', 'Session 3', 'Workshop A', 'Workshop B'] },
  { id: 'date',       label: 'Date',             options: [] }, // will be a date input
];

// ─── STATE ────────────────────────────────────────
let dropdownConfig = [];
let extraFields    = [];
let records        = [];
let sigPad         = null;
let initPad        = null;

// ─── INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderAdminDropdowns();
  renderStandardForm();
  renderExtraFieldsAdmin();
  renderExtraFieldsForm();
  renderTable();
  initSignaturePads();
  restoreLogo();
  restoreSheetMeta();
  document.getElementById('printDate').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
});

// ─── PERSISTENCE ──────────────────────────────────
function loadState() {
  try {
    dropdownConfig = JSON.parse(localStorage.getItem('lafd_dropdowns')) || JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));
    extraFields    = JSON.parse(localStorage.getItem('lafd_extraFields')) || [];
    records        = JSON.parse(localStorage.getItem('lafd_records'))    || [];

    const recipient = localStorage.getItem('lafd_emailRecipient');
    if (recipient) document.getElementById('emailRecipient').value = recipient;
    const cc = localStorage.getItem('lafd_emailCC');
    if (cc) document.getElementById('emailCC').value = cc;
  } catch (e) {
    dropdownConfig = JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));
    extraFields    = [];
    records        = [];
  }
}
function saveDropdowns()   { localStorage.setItem('lafd_dropdowns', JSON.stringify(dropdownConfig)); }
function saveExtraFields() { localStorage.setItem('lafd_extraFields', JSON.stringify(extraFields)); }
function saveRecords()     { localStorage.setItem('lafd_records', JSON.stringify(records)); }
function saveEmailRecipient() { localStorage.setItem('lafd_emailRecipient', document.getElementById('emailRecipient').value); }
function saveEmailCC()        { localStorage.setItem('lafd_emailCC', document.getElementById('emailCC').value); }

function saveSheetTitle() {
  const val = document.getElementById('sheetTitle').value;
  localStorage.setItem('lafd_sheetTitle', val);
  document.getElementById('displayTitle').textContent = val || 'LAFD Fire Safety Program';
}
function saveSheetSubtitle() {
  const val = document.getElementById('sheetSubtitle').value;
  localStorage.setItem('lafd_sheetSubtitle', val);
  document.getElementById('displaySubtitle').textContent = val || 'Participant Sign-In Sheet';
}
function restoreSheetMeta() {
  const t = localStorage.getItem('lafd_sheetTitle');
  const s = localStorage.getItem('lafd_sheetSubtitle');
  if (t) { document.getElementById('sheetTitle').value = t; document.getElementById('displayTitle').textContent = t; }
  if (s) { document.getElementById('sheetSubtitle').value = s; document.getElementById('displaySubtitle').textContent = s; }
}

// ─── ADMIN TOGGLE ─────────────────────────────────
function toggleAdmin() {
  const panel = document.getElementById('adminPanel');
  const btn   = document.getElementById('adminToggleBtn');
  panel.classList.toggle('hidden');
  btn.textContent = panel.classList.contains('hidden') ? '⚙️ Admin' : '✕ Close Admin';
}

// ─── DROPDOWN ADMIN ───────────────────────────────
function renderAdminDropdowns() {
  const grid = document.getElementById('dropdownAdminGrid');
  grid.innerHTML = '';
  dropdownConfig.forEach((dd) => {
    if (dd.id === 'date') return; // date is always a date picker
    const card = document.createElement('div');
    card.className = 'dropdown-editor';
    card.innerHTML = `
      <h4>${escHtml(dd.label)}</h4>
      <ul class="option-list" id="optList_${dd.id}">
        ${dd.options.map((opt, i) => `
          <li class="option-item">
            <span style="flex:1">${escHtml(opt)}</span>
            <button title="Remove" onclick="removeOption('${dd.id}', ${i})">✕</button>
          </li>`).join('')}
      </ul>
      <div class="add-option-row">
        <input class="add-option-input" id="addInput_${dd.id}" placeholder="Add option…" onkeydown="if(event.key==='Enter') addOption('${dd.id}')" />
        <button class="btn btn-sm btn-primary" onclick="addOption('${dd.id}')">+</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function addOption(ddId) {
  const input = document.getElementById(`addInput_${ddId}`);
  const val = input.value.trim();
  if (!val) return;
  const dd = dropdownConfig.find(d => d.id === ddId);
  if (!dd) return;
  dd.options.push(val);
  input.value = '';
  saveDropdowns();
  renderAdminDropdowns();
  renderStandardForm();
}
function removeOption(ddId, idx) {
  const dd = dropdownConfig.find(d => d.id === ddId);
  if (!dd) return;
  dd.options.splice(idx, 1);
  saveDropdowns();
  renderAdminDropdowns();
  renderStandardForm();
}

// ─── STANDARD FORM DROPDOWNS ──────────────────────
function renderStandardForm() {
  const grid = document.getElementById('standardDropdownsGrid');
  grid.innerHTML = '';
  dropdownConfig.forEach((dd) => {
    const group = document.createElement('div');
    group.className = 'form-group';
    if (dd.id === 'date') {
      group.innerHTML = `
        <label class="form-label" for="field_${dd.id}">${escHtml(dd.label)}</label>
        <input type="date" class="form-input" id="field_${dd.id}" />
      `;
    } else {
      group.innerHTML = `
        <label class="form-label" for="field_${dd.id}">${escHtml(dd.label)}</label>
        <select class="form-select" id="field_${dd.id}">
          <option value="">— Select —</option>
          ${dd.options.map(o => `<option value="${escAttr(o)}">${escHtml(o)}</option>`).join('')}
        </select>
      `;
    }
    grid.appendChild(group);
  });
  // Set today's date
  const dateField = document.getElementById('field_date');
  if (dateField && !dateField.value) dateField.value = new Date().toISOString().split('T')[0];
}

// ─── EXTRA CUSTOM FIELDS ──────────────────────────
function addExtraField() {
  extraFields.push({ type: 'text', label: 'Custom Field', options: [] });
  saveExtraFields();
  renderExtraFieldsAdmin();
  renderExtraFieldsForm();
  renderTable();
}
function addExtraDropdown() {
  extraFields.push({ type: 'dropdown', label: 'Custom Dropdown', options: ['Option A', 'Option B'] });
  saveExtraFields();
  renderExtraFieldsAdmin();
  renderExtraFieldsForm();
  renderTable();
}
function removeExtraField(idx) {
  extraFields.splice(idx, 1);
  saveExtraFields();
  renderExtraFieldsAdmin();
  renderExtraFieldsForm();
  renderTable();
}

function renderExtraFieldsAdmin() {
  const container = document.getElementById('extraFieldsAdmin');
  container.innerHTML = '';
  extraFields.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'extra-field-row';
    if (f.type === 'dropdown') {
      row.innerHTML = `
        <input value="${escAttr(f.label)}" placeholder="Field label" oninput="updateExtraLabel(${i}, this.value)" />
        <select onchange="updateExtraType(${i}, this.value)">
          <option value="text" ${f.type==='text'?'selected':''}>Text</option>
          <option value="dropdown" ${f.type==='dropdown'?'selected':''}>Dropdown</option>
        </select>
        <button class="btn btn-sm btn-ghost" onclick="editExtraOptions(${i})" title="Edit options">✎</button>
        <button class="btn btn-sm btn-danger" onclick="removeExtraField(${i})" title="Remove">✕</button>
      `;
    } else {
      row.innerHTML = `
        <input value="${escAttr(f.label)}" placeholder="Field label" oninput="updateExtraLabel(${i}, this.value)" />
        <select onchange="updateExtraType(${i}, this.value)">
          <option value="text" ${f.type==='text'?'selected':''}>Text</option>
          <option value="dropdown" ${f.type==='dropdown'?'selected':''}>Dropdown</option>
        </select>
        <button class="btn btn-sm btn-danger" onclick="removeExtraField(${i})" title="Remove">✕</button>
      `;
    }
    container.appendChild(row);
  });
}

function updateExtraLabel(idx, val) {
  extraFields[idx].label = val;
  saveExtraFields();
  renderExtraFieldsForm();
  renderTable();
}
function updateExtraType(idx, val) {
  extraFields[idx].type = val;
  if (val === 'dropdown' && (!extraFields[idx].options || extraFields[idx].options.length === 0)) {
    extraFields[idx].options = ['Option A', 'Option B'];
  }
  saveExtraFields();
  renderExtraFieldsAdmin();
  renderExtraFieldsForm();
}

function editExtraOptions(idx) {
  const f = extraFields[idx];
  const current = (f.options || []).join('\n');
  const updated = prompt(`Edit options for "${f.label}" (one per line):`, current);
  if (updated === null) return;
  extraFields[idx].options = updated.split('\n').map(s => s.trim()).filter(Boolean);
  saveExtraFields();
  renderExtraFieldsAdmin();
  renderExtraFieldsForm();
}

function renderExtraFieldsForm() {
  const grid = document.getElementById('extraFieldsForm');
  grid.innerHTML = '';
  extraFields.forEach((f, i) => {
    const group = document.createElement('div');
    group.className = 'form-group';
    if (f.type === 'dropdown') {
      group.innerHTML = `
        <label class="form-label" for="extra_${i}">${escHtml(f.label)}</label>
        <select class="form-select" id="extra_${i}">
          <option value="">— Select —</option>
          ${(f.options || []).map(o => `<option value="${escAttr(o)}">${escHtml(o)}</option>`).join('')}
        </select>
      `;
    } else {
      group.innerHTML = `
        <label class="form-label" for="extra_${i}">${escHtml(f.label)}</label>
        <input type="text" class="form-input" id="extra_${i}" placeholder="Enter ${escAttr(f.label)}…" />
      `;
    }
    grid.appendChild(group);
  });
}

// ─── SIGNATURE PADS ───────────────────────────────
function initSignaturePads() {
  sigPad  = new SignaturePad(document.getElementById('sigCanvas'));
  initPad = new SignaturePad(document.getElementById('initCanvas'));
}
function clearCanvas(id) {
  if (id === 'sigCanvas')  sigPad.clear();
  if (id === 'initCanvas') initPad.clear();
}

// ─── LOGO UPLOAD ──────────────────────────────────
function uploadLogo(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataURL = e.target.result;
    localStorage.setItem('lafd_logo', dataURL);
    showLogo(dataURL);
  };
  reader.readAsDataURL(file);
}
function showLogo(dataURL) {
  const img  = document.getElementById('logoImg');
  const ph   = document.getElementById('logoPlaceholder');
  img.src    = dataURL;
  img.classList.remove('hidden');
  ph.classList.add('hidden');
}
function restoreLogo() {
  const saved = localStorage.getItem('lafd_logo');
  if (saved) showLogo(saved);
}

// ─── SUBMIT SIGN-IN ───────────────────────────────
function submitSignIn() {
  // Collect standard fields
  const entry = { id: Date.now(), timestamp: new Date().toISOString() };
  let missingFields = [];

  dropdownConfig.forEach((dd) => {
    const el = document.getElementById(`field_${dd.id}`);
    entry[dd.id] = el ? el.value : '';
    if (!entry[dd.id]) missingFields.push(dd.label);
  });

  // Collect extra fields
  extraFields.forEach((f, i) => {
    const el = document.getElementById(`extra_${i}`);
    entry[`extra_${i}`] = el ? el.value : '';
  });

  // Capture signatures
  if (sigPad.isEmpty()) {
    showToast('⚠️ Please provide a signature before submitting.');
    return;
  }
  entry.signature = sigPad.toDataURL('image/png');
  entry.initials  = !initPad.isEmpty() ? initPad.toDataURL('image/png') : '';

  records.push(entry);
  saveRecords();
  renderTable();
  resetForm();
  showToast('✅ Sign-in recorded successfully!');
}

function resetForm() {
  dropdownConfig.forEach((dd) => {
    const el = document.getElementById(`field_${dd.id}`);
    if (!el) return;
    if (dd.id === 'date') el.value = new Date().toISOString().split('T')[0];
    else el.value = '';
  });
  extraFields.forEach((_, i) => {
    const el = document.getElementById(`extra_${i}`);
    if (el) el.value = '';
  });
  sigPad.clear();
  initPad.clear();
}

// ─── TABLE RENDER ─────────────────────────────────
function renderTable() {
  const thead  = document.getElementById('tableHead');
  const tbody  = document.getElementById('tableBody');
  const empty  = document.getElementById('emptyState');
  const table  = document.getElementById('recordsTable');

  // Build header
  const stdLabels = dropdownConfig.map(d => d.label);
  const exLabels  = extraFields.map(f => f.label);
  const allLabels = [...stdLabels, ...exLabels, 'Signature', 'Initials', 'Time', 'Delete'];

  thead.innerHTML = `<tr>${allLabels.map((l, i) =>
    `<th${i === allLabels.length - 1 ? ' class="no-print"' : ''}>${escHtml(l)}</th>`
  ).join('')}</tr>`;

  tbody.innerHTML = '';

  if (records.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  table.style.display = '';
  empty.style.display = 'none';

  records.forEach((r, idx) => {
    const tr = document.createElement('tr');
    let cells = '';
    dropdownConfig.forEach(dd => {
      cells += `<td>${escHtml(r[dd.id] || '—')}</td>`;
    });
    extraFields.forEach((_, i) => {
      cells += `<td>${escHtml(r[`extra_${i}`] || '—')}</td>`;
    });
    cells += `<td class="sig-cell">${r.signature ? `<img src="${r.signature}" alt="sig" />` : '—'}</td>`;
    cells += `<td class="init-cell">${r.initials ? `<img src="${r.initials}" alt="initials" />` : '—'}</td>`;
    cells += `<td>${formatTime(r.timestamp)}</td>`;
    cells += `<td class="no-print"><button class="btn btn-sm btn-danger" onclick="deleteRecord(${idx})">✕</button></td>`;
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });
}

function deleteRecord(idx) {
  if (!confirm('Remove this sign-in entry?')) return;
  records.splice(idx, 1);
  saveRecords();
  renderTable();
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── EMAIL ────────────────────────────────────────
function emailSheet() {
  if (records.length === 0) { showToast('⚠️ No sign-in records to email.'); return; }

  const recipient = document.getElementById('emailRecipient').value || 'grants@lacity.org';
  const cc        = document.getElementById('emailCC').value || '';
  const title     = document.getElementById('displayTitle').textContent;
  const subtitle  = document.getElementById('displaySubtitle').textContent;
  const dateStr   = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const stdLabels = dropdownConfig.map(d => d.label);
  const exLabels  = extraFields.map(f => f.label);
  const allLabels = [...stdLabels, ...exLabels, 'Time'];

  let tableRows = '';
  records.forEach((r) => {
    let cells = '';
    dropdownConfig.forEach(dd => { cells += `<td style="padding:6px 10px;border:1px solid #ddd">${escHtml(r[dd.id] || '—')}</td>`; });
    extraFields.forEach((_, i) => { cells += `<td style="padding:6px 10px;border:1px solid #ddd">${escHtml(r[`extra_${i}`] || '—')}</td>`; });
    cells += `<td style="padding:6px 10px;border:1px solid #ddd">${formatTime(r.timestamp)}</td>`;
    tableRows += `<tr>${cells}</tr>`;
  });

  const headerCells = allLabels.map(l => `<th style="padding:8px 10px;background:#0D1B2A;color:#fff;border:1px solid #0D1B2A;text-align:left">${escHtml(l)}</th>`).join('');

  const body = encodeURIComponent(
    `${title} — ${subtitle}\nDate: ${dateStr}\nTotal Sign-Ins: ${records.length}\n\nPlease find the sign-in data below:\n\n` +
    allLabels.join(' | ') + '\n' +
    records.map(r => {
      const vals = [];
      dropdownConfig.forEach(dd => vals.push(r[dd.id] || '—'));
      extraFields.forEach((_, i) => vals.push(r[`extra_${i}`] || '—'));
      vals.push(formatTime(r.timestamp));
      return vals.join(' | ');
    }).join('\n') +
    '\n\n(Note: Signatures are captured digitally and available in the printed/PDF version.)'
  );

  const subject = encodeURIComponent(`${title} — Sign-In Sheet — ${dateStr}`);
  const ccParam  = cc ? `&cc=${encodeURIComponent(cc)}` : '';
  const mailto   = `mailto:${recipient}?subject=${subject}${ccParam}&body=${body}`;

  window.location.href = mailto;
  showToast('📧 Opening Gmail / email client…');
}

// ─── EXPORT CSV ──────────────────────────────────
function exportCSV() {
  if (records.length === 0) { showToast('⚠️ No records to export.'); return; }

  const stdLabels = dropdownConfig.map(d => d.label);
  const exLabels  = extraFields.map(f => f.label);
  const header    = [...stdLabels, ...exLabels, 'Timestamp'].join(',');

  const rows = records.map(r => {
    const vals = [];
    dropdownConfig.forEach(dd => vals.push(`"${(r[dd.id] || '').replace(/"/g, '""')}"`));
    extraFields.forEach((_, i) => vals.push(`"${(r[`extra_${i}`] || '').replace(/"/g, '""')}"`));
    vals.push(`"${formatTime(r.timestamp)}"`);
    return vals.join(',');
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `lafd-signin-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('⬇️ CSV downloaded!');
}

// ─── QR CODE ─────────────────────────────────────
function generateQR() {
  const url = window.location.href;
  document.getElementById('qrUrlDisplay').textContent = url;
  const modal = document.getElementById('qrModal');
  modal.classList.remove('hidden');
  const container = document.getElementById('qrContainer');
  container.innerHTML = '';
  // Use Google Charts QR API (free, no library needed)
  const size = 240;
  const qrUrl = `https://chart.googleapis.com/chart?chs=${size}x${size}&cht=qr&chl=${encodeURIComponent(url)}&choe=UTF-8`;
  const img = document.createElement('img');
  img.src = qrUrl;
  img.alt = 'QR Code';
  img.width = size;
  img.height = size;
  img.style.borderRadius = '8px';
  container.appendChild(img);
}
function closeQR(e) { if (e.target.id === 'qrModal') closeQRBtn(); }
function closeQRBtn() { document.getElementById('qrModal').classList.add('hidden'); }

function copyURL() {
  navigator.clipboard.writeText(window.location.href).then(() => showToast('📋 URL copied!')).catch(() => showToast('⚠️ Could not copy URL.'));
}

// ─── CLEAR ALL DATA ──────────────────────────────
function clearAllData() {
  if (!confirm('Delete ALL sign-in records? This cannot be undone.')) return;
  records = [];
  saveRecords();
  renderTable();
  showToast('🗑️ All records cleared.');
}

// ─── TOAST ───────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

// ─── HELPERS ─────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(str) {
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ══════════════════════════════════════════════
   INLINE SIGNATURE PAD LIBRARY
   Based on signature_pad by Szymon Nowak (MIT)
   Trimmed & adapted for touch + mouse + stylus
══════════════════════════════════════════════ */
class SignaturePad {
  constructor(canvas, opts = {}) {
    this.canvas     = canvas;
    this.ctx        = canvas.getContext('2d');
    this.penColor   = opts.penColor   || '#0D1B2A';
    this.lineWidth  = opts.lineWidth  || 2.5;
    this.isEmpty_   = true;
    this._points    = [];
    this._drawing   = false;

    this.ctx.strokeStyle = this.penColor;
    this.ctx.lineWidth   = this.lineWidth;
    this.ctx.lineCap     = 'round';
    this.ctx.lineJoin    = 'round';

    // Make canvas resolution-sharp on HiDPI screens
    this._resizeCanvas();

    // Mouse events
    canvas.addEventListener('mousedown',  this._onDown.bind(this));
    canvas.addEventListener('mousemove',  this._onMove.bind(this));
    canvas.addEventListener('mouseup',    this._onUp.bind(this));
    canvas.addEventListener('mouseleave', this._onUp.bind(this));
    // Touch / Stylus events
    canvas.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    canvas.addEventListener('touchmove',  this._onTouchMove.bind(this),  { passive: false });
    canvas.addEventListener('touchend',   this._onUp.bind(this));
    canvas.addEventListener('touchcancel',this._onUp.bind(this));
  }

  _resizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = this.canvas.offsetWidth  || parseInt(this.canvas.getAttribute('width'))  || 400;
    const h = this.canvas.offsetHeight || parseInt(this.canvas.getAttribute('height')) || 120;
    this.canvas.width  = w * ratio;
    this.canvas.height = h * ratio;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(ratio, ratio);
    this.ctx.strokeStyle = this.penColor;
    this.ctx.lineWidth   = this.lineWidth;
    this.ctx.lineCap     = 'round';
    this.ctx.lineJoin    = 'round';
  }

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  _onDown(e) {
    e.preventDefault();
    this._drawing = true;
    this.isEmpty_ = false;
    const p = this._getPos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
    this._last = p;
  }
  _onMove(e) {
    if (!this._drawing) return;
    e.preventDefault();
    const p = this._getPos(e);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
  }
  _onUp() { this._drawing = false; }

  _onTouchStart(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    this._onDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} });
  }
  _onTouchMove(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    this._onMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} });
  }

  isEmpty()      { return this.isEmpty_; }
  clear() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    this.ctx.clearRect(0, 0, this.canvas.width / ratio, this.canvas.height / ratio);
    this.isEmpty_ = true;
  }
  toDataURL(type) { return this.canvas.toDataURL(type || 'image/png'); }
}
