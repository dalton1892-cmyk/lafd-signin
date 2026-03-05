/* ══════════════════════════════════════════════════
   LAFD Sign-In Sheet — app.js
   All state is persisted in localStorage.
══════════════════════════════════════════════════ */

// ─── DEFAULT CONFIG ────────────────────────────────
const DEFAULT_DROPDOWNS = [
  { id: 'program', label: 'Program Name', options: ['Fire Safety 101', 'Fire Explorer', 'Youth Academy', 'Community Outreach', 'CERT Training'] },
  { id: 'location', label: 'Location', options: ['Station 1', 'Station 5', 'Station 12', 'Community Center', 'School Site'] },
  { id: 'instructor', label: 'Instructor', options: ['Captain Garcia', 'Engineer Reyes', 'FF Thompson', 'Lt. Martinez'] },
  { id: 'session', label: 'Class / Course', options: ['Class 1', 'Class 2', 'Class 3', 'Workshop A', 'Workshop B'] },
  { id: 'vcode', label: 'V-Code', options: ['V-123', 'V-456'] },
  { id: 'vcode_cutoff', label: 'V-Code Cut Off', options: ['30 mins', '60 mins'] },
  { id: 'eid', label: 'EID #', options: [] },
  { id: 'fiscal_year', label: 'Fiscal Year', options: ['FY25', 'FY26', 'FY27'] },
  { id: 'date', label: 'Today\'s Date', options: [] }, // will be a date input
];

// ─── STATE ────────────────────────────────────────
let dropdownConfig = [];
let extraFields = [];
let records = [];
let sigPad = null;
let initPads = {}; // new: Object mapping dates to their SignaturePads
let classConfig = { startDate: '', endDate: '', startTime: '', endTime: '' };
let trainings = [];   // [{ id, name }]
let _currentQRUrl = '';   // for copy/download
let currentStampedTime = null;
let syncUrl = ""; // Google Apps Script URL for live database
let instructorAccounts = []; // Managed by admin
let pendingAttachment = null; // Temp storage for file being attached
let activeDateFilter = null;  // null = show all, otherwise 'YYYY-MM-DD'
let sessionArchives = [];     // [{ name, date, records[] }]

// ─── AUTH & ROLES ─────────────────────────────────
const ADMIN_EMAIL = 'lafd.grants@lacity.org';
const ADMIN_PASS = 'FigPlaza1225$$';

function checkAuth() {
  const role = sessionStorage.getItem('lafd_role');
  if (!role) { window.location.replace('login.html'); return null; }
  return role;
}

function logout() {
  sessionStorage.clear();
  window.location.replace('login.html');
}

function applyRoleBasedUI(role) {
  document.body.setAttribute('data-role', role);

  // Set role badge
  const badge = document.getElementById('roleIndicator');
  if (badge) {
    const labels = { admin: '🔑 Admin', instructor: '👤 Instructor', student: '🎓 Student' };
    badge.textContent = labels[role] || role;
    badge.style.display = (role === 'student') ? 'none' : 'inline-flex';
  }

  if (role === 'admin') return; // Full access — nothing to restrict

  // Hide admin-only controls
  document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'none'; });
  // Hide records table for non-admins
  const rec = document.querySelector('.records-section');
  if (rec) rec.style.display = 'none';

  if (role === 'instructor') {
    // Pre-fill instructor's own name and EID
    const iData = JSON.parse(sessionStorage.getItem('lafd_instructorData') || 'null');
    if (iData) {
      const nameEl = document.getElementById('studentName');
      if (nameEl) { nameEl.value = iData.displayName || ''; nameEl.readOnly = true; nameEl.style.background = '#eef'; }
      const eidEl = document.getElementById('field_eid');
      if (eidEl) { eidEl.value = iData.eid || ''; }
    }
    // Lock non-personal fields
    restrictFormForRole('instructor');
  }

  if (role === 'student') {
    // Hide the main header and admin buttons, but KEEP the form active
    document.querySelector('.app-header').style.display = 'none';

    // Specifically hide the admin-related items while keeping form buttons
    document.querySelectorAll('.header-actions .btn, .admin-only').forEach(el => {
      el.style.display = 'none';
    });

    restrictFormForRole('student');
  }
}

function restrictFormForRole(role) {
  // Hide all standard dropdown groups except EID and date
  const grid = document.getElementById('standardDropdownsGrid');
  if (grid) {
    grid.querySelectorAll('.form-group').forEach(group => {
      const input = group.querySelector('input, select');
      if (!input) return;
      const id = input.id;
      if (id === 'field_eid' || id === 'field_date') return; // Keep visible
      group.style.display = 'none'; // Hide pre-filled fields
    });
  }
  // Hide extra custom fields for student/instructor
  const extraGrid = document.getElementById('extraFieldsForm');
  if (extraGrid) extraGrid.style.display = 'none';
}

// ─── INSTRUCTOR ACCOUNT MANAGEMENT (Admin only) ───
function renderInstructorAccounts() {
  instructorAccounts = JSON.parse(localStorage.getItem('lafd_instructorAccounts') || '[]');
  const container = document.getElementById('instructorAccountsList');
  if (!container) return;

  if (instructorAccounts.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:0.8rem;">No instructor accounts yet.</p>';
    return;
  }

  container.innerHTML = instructorAccounts.map((a, i) => `
    <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.05);border-radius:8px;margin-bottom:0.4rem;">
      <span style="flex:1;color:#fff;font-size:0.85rem;"><strong>${escHtml(a.displayName)}</strong> — ${escHtml(a.email)}</span>
      <span style="color:#9ca3af;font-size:0.8rem;">EID: ${escHtml(a.eid || '—')}</span>
      <button class="btn btn-sm btn-danger" onclick="removeInstructorAccount(${i})">✕</button>
    </div>
  `).join('');
}

function addInstructorAccount() {
  const displayName = document.getElementById('newInstrName').value.trim();
  const email = document.getElementById('newInstrEmail').value.trim().toLowerCase();
  const password = document.getElementById('newInstrPass').value;
  const eid = document.getElementById('newInstrEid').value.trim();

  if (!displayName || !email || !password) {
    showToast('⚠️ Name, email and password are required.');
    return;
  }
  if (instructorAccounts.find(a => a.email === email)) {
    showToast('⚠️ An account with that email already exists.');
    return;
  }

  instructorAccounts.push({ displayName, email, password, eid });
  localStorage.setItem('lafd_instructorAccounts', JSON.stringify(instructorAccounts));

  // Clear fields
  ['newInstrName', 'newInstrEmail', 'newInstrPass', 'newInstrEid'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderInstructorAccounts();
  showToast(`✅ Instructor account created for ${displayName}.`);
}

function removeInstructorAccount(idx) {
  if (!confirm(`Remove account for ${instructorAccounts[idx].displayName}?`)) return;
  instructorAccounts.splice(idx, 1);
  localStorage.setItem('lafd_instructorAccounts', JSON.stringify(instructorAccounts));
  renderInstructorAccounts();
  showToast('Account removed.');
}

document.addEventListener('DOMContentLoaded', () => {
  const role = checkAuth();
  if (!role) return; // redirect in progress

  loadState();
  applyURLParams();       // Pre-fill from QR code URL params
  renderAdminDropdowns();
  renderStandardForm();
  renderExtraFieldsAdmin();
  renderExtraFieldsForm();
  renderTable();
  initSignaturePads();
  restoreLogo();
  restoreSheetMeta();
  renderTrainingList();
  renderInstructorAccounts();
  document.getElementById('printDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  startClock();

  // Apply role UI AFTER all rendering is done
  applyRoleBasedUI(role);
});

// ─── PERSISTENCE ──────────────────────────────────
function loadState() {
  try {
    dropdownConfig = JSON.parse(localStorage.getItem('lafd_dropdowns')) || JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));

    // Migration: add missing default dropdowns to existing config
    DEFAULT_DROPDOWNS.forEach(def => {
      if (!dropdownConfig.find(d => d.id === def.id)) {
        dropdownConfig.push(JSON.parse(JSON.stringify(def)));
      }
    });

    const dField = dropdownConfig.find(d => d.id === 'date');
    if (dField && dField.label === 'Date') dField.label = "Today's Date";

    classConfig = JSON.parse(localStorage.getItem('lafd_classConfig')) || { startDate: '', endDate: '', startTime: '', endTime: '' };
    restoreClassConfig();

    extraFields = JSON.parse(localStorage.getItem('lafd_extraFields')) || [];
    records = JSON.parse(localStorage.getItem('lafd_records')) || [];
    trainings = JSON.parse(localStorage.getItem('lafd_trainings')) || [];

    const recipient = localStorage.getItem('lafd_emailRecipient');
    if (recipient) document.getElementById('emailRecipient').value = recipient;
    const cc = localStorage.getItem('lafd_emailCC');
    if (cc) document.getElementById('emailCC').value = cc;

    syncUrl = localStorage.getItem('lafd_syncUrl') || "";
    if (document.getElementById('syncUrl')) document.getElementById('syncUrl').value = syncUrl;
    sessionArchives = JSON.parse(localStorage.getItem('lafd_sessionArchives') || '[]');
  } catch (e) {
    dropdownConfig = JSON.parse(JSON.stringify(DEFAULT_DROPDOWNS));
    extraFields = [];
    records = [];
    trainings = [];
    sessionArchives = [];
  }
}
function saveDropdowns() { localStorage.setItem('lafd_dropdowns', JSON.stringify(dropdownConfig)); }
function saveExtraFields() { localStorage.setItem('lafd_extraFields', JSON.stringify(extraFields)); }
function saveRecords() { localStorage.setItem('lafd_records', JSON.stringify(records)); }
function saveTrainings() { localStorage.setItem('lafd_trainings', JSON.stringify(trainings)); }
function saveArchives() { localStorage.setItem('lafd_sessionArchives', JSON.stringify(sessionArchives)); }
function saveEmailRecipient() { localStorage.setItem('lafd_emailRecipient', document.getElementById('emailRecipient').value); }
function saveEmailCC() { localStorage.setItem('lafd_emailCC', document.getElementById('emailCC').value); }
function saveSyncUrl() {
  syncUrl = document.getElementById('syncUrl').value.trim();
  localStorage.setItem('lafd_syncUrl', syncUrl);
}

// ── TITLE / SUBTITLE ──────────────────────────────
// Called from admin panel inputs
function saveSheetTitle() {
  const val = document.getElementById('sheetTitle').value.trim();
  localStorage.setItem('lafd_sheetTitle', val);
  document.getElementById('displayTitle').textContent = val || 'LAFD Fire Safety Program';
}
function saveSheetSubtitle() {
  const val = document.getElementById('sheetSubtitle').value.trim();
  localStorage.setItem('lafd_sheetSubtitle', val);
  document.getElementById('displaySubtitle').textContent = val || 'Participant Sign-In Sheet';
}

function restoreSheetMeta() {
  const t = localStorage.getItem('lafd_sheetTitle');
  const s = localStorage.getItem('lafd_sheetSubtitle');
  if (t) {
    document.getElementById('displayTitle').textContent = t;
    document.getElementById('sheetTitle').value = t;
  }
  if (s) {
    document.getElementById('displaySubtitle').textContent = s;
    document.getElementById('sheetSubtitle').value = s;
  }
}

// ─── URL PARAMS (QR pre-fill) ─────────────────────
function applyURLParams() {
  const params = new URLSearchParams(window.location.search);
  params.forEach((val, key) => {
    const el = document.getElementById(`field_${key}`);
    if (el) el.value = val;
  });
  // If ?training param is present, set title/subtitle
  const training = params.get('training');
  if (training) {
    // Update subtitle to show training name
    const sub = document.getElementById('displaySubtitle');
    if (sub) {
      sub.textContent = training;
      localStorage.setItem('lafd_sheetSubtitle', training);
    }
  }
}

// ─── ADMIN TOGGLE ─────────────────────────────────
function toggleAdmin() {
  const panel = document.getElementById('adminPanel');
  const btn = document.getElementById('adminToggleBtn');
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
      <div class="dd-label-row">
        <input class="add-option-input" id="ddLabel_${dd.id}" value="${escAttr(dd.label)}" placeholder="Column label…" oninput="updateDropdownLabel('${dd.id}', this.value)" />
      </div>
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

function updateDropdownLabel(ddId, val) {
  const dd = dropdownConfig.find(d => d.id === ddId);
  if (!dd) return;
  dd.label = val || ddId;
  saveDropdowns();
  renderStandardForm();
  renderTable();
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
      // Use input + datalist so users can type freely OR pick from suggestions
      const listId = `list_${dd.id}`;
      group.innerHTML = `
        <label class="form-label" for="field_${dd.id}">${escHtml(dd.label)}</label>
        <input type="text" class="form-input" id="field_${dd.id}"
               list="${listId}" placeholder="Type or choose…" autocomplete="off" />
        <datalist id="${listId}">
          ${dd.options.map(o => `<option value="${escAttr(o)}"></option>`).join('')}
        </datalist>
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
          <option value="text" ${f.type === 'text' ? 'selected' : ''}>Text</option>
          <option value="dropdown" ${f.type === 'dropdown' ? 'selected' : ''}>Dropdown</option>
        </select>
        <button class="btn btn-sm btn-ghost" onclick="editExtraOptions(${i})" title="Edit options">✎</button>
        <button class="btn btn-sm btn-danger" onclick="removeExtraField(${i})" title="Remove">✕</button>
      `;
    } else {
      row.innerHTML = `
        <input value="${escAttr(f.label)}" placeholder="Field label" oninput="updateExtraLabel(${i}, this.value)" />
        <select onchange="updateExtraType(${i}, this.value)">
          <option value="text" ${f.type === 'text' ? 'selected' : ''}>Text</option>
          <option value="dropdown" ${f.type === 'dropdown' ? 'selected' : ''}>Dropdown</option>
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
      // Use input + datalist so users can type freely OR pick from suggestions
      const listId = `list_extra_${i}`;
      group.innerHTML = `
        <label class="form-label" for="extra_${i}">${escHtml(f.label)}</label>
        <input type="text" class="form-input" id="extra_${i}"
               list="${listId}" placeholder="Type or choose…" autocomplete="off" />
        <datalist id="${listId}">
          ${(f.options || []).map(o => `<option value="${escAttr(o)}"></option>`).join('')}
        </datalist>
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

// ─── SIGNATURE PADS & CLASS DATE LOGIC ────────────
function initSignaturePads() {
  sigPad = new SignaturePad(document.getElementById('sigCanvas'));
  renderInitials();
}

function clearCanvas(id) {
  if (id === 'sigCanvas') sigPad.clear();
}

function getDatesArray(startStr, endStr) {
  if (!startStr || !endStr) return startStr ? [{ d: new Date(startStr + 'T12:00:00'), str: startStr }] : [];
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  const arr = [];
  let curr = new Date(start);
  while (curr <= end) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    arr.push({ d: new Date(curr), str: `${y}-${m}-${d}` });
    curr.setDate(curr.getDate() + 1);
  }
  return arr;
}

function getTodayStr() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

function renderInitials() {
  const wrap = document.getElementById('dynamicInitialsWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  initPads = {};

  if (!classConfig.startDate || !classConfig.endDate) {
    wrap.innerHTML = '<div style="margin-top:10px;" class="hint">Admins: Set Class Dates in Admin Settings.</div>';
    return;
  }

  const dates = getDatesArray(classConfig.startDate, classConfig.endDate);
  const todayStr = getTodayStr();

  dates.forEach((obj) => {
    const dStr = obj.str;
    const isToday = dStr === todayStr;
    const labelStr = obj.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' Initials';

    const block = document.createElement('div');
    block.className = 'sig-block sig-block-sm';
    block.innerHTML = `
      <label class="form-label">${labelStr}</label>
      <div class="canvas-wrap" style="${!isToday ? 'opacity:0.3; pointer-events:none; background:#f0f0f0;' : ''}">
        <canvas id="initCanvas_${dStr}" width="160" height="120"></canvas>
      </div>
      ${isToday ? `<div class="canvas-actions"><button class="btn btn-sm btn-ghost" onclick="clearInitPad('${dStr}')">✕ Clear</button></div>` : ''}
    `;
    wrap.appendChild(block);

    if (isToday) {
      initPads[dStr] = new SignaturePad(document.getElementById(`initCanvas_${dStr}`));
    }
  });

  const infoEl = document.getElementById('displayClassInfo');
  if (infoEl) {
    if (classConfig.startDate && classConfig.endDate) {
      infoEl.textContent = `Class Dates: ${classConfig.startDate} to ${classConfig.endDate} | Time: ${classConfig.startTime} to ${classConfig.endTime}`;
    } else {
      infoEl.textContent = '';
    }
  }
}

function clearInitPad(dStr) {
  if (initPads[dStr]) initPads[dStr].clear();
}

function saveClassConfig() {
  const sDate = document.getElementById('adminStartDate');
  if (sDate) {
    classConfig.startDate = sDate.value;
    classConfig.endDate = document.getElementById('adminEndDate').value;
    classConfig.startTime = document.getElementById('adminStartTime').value;
    classConfig.endTime = document.getElementById('adminEndTime').value;
    localStorage.setItem('lafd_classConfig', JSON.stringify(classConfig));
    renderInitials();
  }
}

function restoreClassConfig() {
  const sDate = document.getElementById('adminStartDate');
  if (sDate) {
    sDate.value = classConfig.startDate || '';
    document.getElementById('adminEndDate').value = classConfig.endDate || '';
    document.getElementById('adminStartTime').value = classConfig.startTime || '';
    document.getElementById('adminEndTime').value = classConfig.endTime || '';
  }
}

// ─── LOGO UPLOAD ──────────────────────────────────
function uploadLogo(event, side) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataURL = e.target.result;
    localStorage.setItem(`lafd_logo_${side}`, dataURL);
    showLogo(dataURL, side);
  };
  reader.readAsDataURL(file);
}

function showLogo(dataURL, side) {
  const imgId = side === 'right' ? 'rightLogoImg' : 'logoImg';
  const phId = side === 'right' ? 'rightLogoPlaceholder' : 'logoPlaceholder';
  const img = document.getElementById(imgId);
  const ph = document.getElementById(phId);
  if (!img || !ph) return;

  img.src = dataURL;
  img.classList.remove('hidden');
  ph.classList.add('hidden');
}

function clearLogo(side) {
  localStorage.removeItem(`lafd_logo_${side}`);
  const imgId = side === 'right' ? 'rightLogoImg' : 'logoImg';
  const phId = side === 'right' ? 'rightLogoPlaceholder' : 'logoPlaceholder';
  const img = document.getElementById(imgId);
  const ph = document.getElementById(phId);
  if (img) {
    img.src = '';
    img.classList.add('hidden');
  }
  if (ph) ph.classList.remove('hidden');
}

function restoreLogo() {
  const left = localStorage.getItem('lafd_logo_left') || localStorage.getItem('lafd_logo');
  const right = localStorage.getItem('lafd_logo_right');

  // LOGO FALLBACK: If on a phone (no local storage), use a default LAFD logo
  if (left) {
    showLogo(left, 'left');
  } else {
    showLogo('https://www.lafd.org/sites/default/files/lafd-logo-new.png', 'left');
  }

  if (right) showLogo(right, 'right');
}

// ─── TIMESTAMP ────────────────────────────────────
function startClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  setInterval(() => {
    el.textContent = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, 1000);
  el.textContent = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function stampTimeIn() {
  const now = new Date();
  currentStampedTime = now.toISOString();
  const el = document.getElementById('stampedTime');
  el.textContent = 'Stamped: ' + formatTime(currentStampedTime);
  el.classList.remove('hidden');
}

function clearTimeIn() {
  currentStampedTime = null;
  const el = document.getElementById('stampedTime');
  el.textContent = '';
  el.classList.add('hidden');
}

// ─── SUBMIT SIGN-IN ───────────────────────────────
function submitSignIn() {
  const nameEl = document.getElementById('studentName');
  if (!nameEl || !nameEl.value.trim()) {
    showToast('⚠️ Name is required.');
    return;
  }

  const name = nameEl.value.trim();
  const existingIdx = records.findIndex(r => r.studentName && r.studentName.toLowerCase() === name.toLowerCase());

  const todayStr = getTodayStr();
  const isFirstDate = classConfig.startDate ? todayStr === classConfig.startDate : true;

  if (isFirstDate && sigPad.isEmpty()) {
    showToast('⚠️ Full Signature is required on the first day of class.');
    return;
  }

  if (classConfig.startDate && classConfig.endDate) {
    if (!initPads[todayStr]) {
      showToast('⚠️ Today is not a scheduled class date.');
      return;
    }
    if (initPads[todayStr].isEmpty()) {
      showToast('⚠️ Please provide your Initials for today.');
      return;
    }
  }

  // Auto-stamp if missing
  if (!currentStampedTime) {
    stampTimeIn();
  }

  // Only require ALL fields for admin; students/instructors get pre-filled fields
  const role = sessionStorage.getItem('lafd_role') || 'student';
  if (role === 'admin') {
    let missingField = false;
    dropdownConfig.forEach((dd) => {
      const el = document.getElementById(`field_${dd.id}`);
      if (!el || !el.value.trim()) missingField = true;
    });
    extraFields.forEach((_, i) => {
      const el = document.getElementById(`extra_${i}`);
      if (!el || !el.value.trim()) missingField = true;
    });
    if (missingField) {
      showToast('⚠️ Please fill out all required fields.');
      return;
    }
  }

  let entry = {};
  if (existingIdx !== -1) {
    entry = records[existingIdx];
  } else {
    entry = { id: Date.now(), studentName: name, initialsObj: {} };
  }

  entry.timestamp = new Date().toISOString();
  if (currentStampedTime) entry.stampedTime = currentStampedTime;

  if (!sigPad.isEmpty()) {
    entry.signature = sigPad.toDataURL('image/png');
  }

  if (!entry.initialsObj) entry.initialsObj = {};
  if (initPads[todayStr] && !initPads[todayStr].isEmpty()) {
    entry.initialsObj[todayStr] = initPads[todayStr].toDataURL('image/png');
  }

  dropdownConfig.forEach((dd) => {
    const el = document.getElementById(`field_${dd.id}`);
    if (el && el.value) entry[dd.id] = el.value;
  });

  extraFields.forEach((_, i) => {
    const el = document.getElementById(`extra_${i}`);
    if (el && el.value) entry[`extra_${i}`] = el.value;
  });

  // Attach any pending file
  if (pendingAttachment) {
    entry.attachment = pendingAttachment;
    pendingAttachment = null;
  }

  if (existingIdx === -1) records.push(entry);

  saveRecords();
  renderTable();
  resetForm();
  showToast('✅ Sign-in recorded locally.');

  // GOOGLE LIVE SYNC — OPTIONAL
  if (syncUrl) {
    showToast('☁️ Syncing to Google Sheets...');
    fetch(syncUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    }).then(() => {
      showToast('✅ Live Sync Success!');
    }).catch(err => {
      console.error("Sync error:", err);
      showToast('⚠️ Sync failed, but saved locally.');
    });
  }
}

function resetForm() {
  const nameEl = document.getElementById('studentName');
  if (nameEl) nameEl.value = '';

  clearTimeIn();

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

  if (sigPad) sigPad.clear();
  const todayStr = getTodayStr();
  if (initPads[todayStr]) initPads[todayStr].clear();
}

// ─── TABLE RENDER & DATALIST ─────────────────────────
function updateStudentDatalist() {
  const list = document.getElementById('studentNameList');
  if (!list) return;

  // Get unique names from past records
  const names = Array.from(new Set(records.map(r => r.studentName).filter(Boolean)));

  list.innerHTML = names.map(n => `<option value="${escAttr(n)}">`).join('');
}

function renderTable() {
  updateStudentDatalist();

  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  const empty = document.getElementById('emptyState');
  const table = document.getElementById('recordsTable');

  const dates = getDatesArray(classConfig.startDate, classConfig.endDate);
  const initCols = dates.map(obj => ({
    dStr: obj.str,
    label: obj.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' Init'
  }));

  const stdLabels = dropdownConfig.map(d => d.label);
  const exLabels = extraFields.map(f => f.label);
  const infoLabels = [
    '#', 'Name', 'Time-In',
    ...stdLabels, ...exLabels
  ];
  const totalCols = infoLabels.length + 1; // +1 for delete col

  thead.innerHTML = `<tr>${infoLabels.map((l, i) =>
    `<th>${escHtml(l)}</th>`
  ).join('')}<th class="no-print">Delete</th></tr>`;

  // Apply day session date filter
  const displayRecords = activeDateFilter
    ? records.filter(r => matchesDateFilter(r, activeDateFilter))
    : records;

  if (displayRecords.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    empty.querySelector('p').textContent = activeDateFilter
      ? `No sign-ins found for ${activeDateFilter}. Try 'Show All' to see all records.`
      : 'No sign-ins yet. Submit the form above to get started.';
    return;
  }
  table.style.display = '';
  empty.style.display = 'none';

  displayRecords.forEach((r, idx) => {
    const realIdx = records.indexOf(r);
    // Row 1: The info fields
    const trInfo = document.createElement('tr');
    trInfo.classList.add('info-row');

    let cellsInfo = '';
    cellsInfo += `<td style="font-weight:700;">${idx + 1}</td>`;
    cellsInfo += `<td><strong>${escHtml(r.studentName || '—')}</strong></td>`;
    cellsInfo += `<td>${escHtml(r.stampedTime ? formatTime(r.stampedTime) : '—')}</td>`;

    dropdownConfig.forEach(dd => {
      cellsInfo += `<td>${escHtml(r[dd.id] || '—')}</td>`;
    });
    extraFields.forEach((_, i) => {
      cellsInfo += `<td>${escHtml(r[`extra_${i}`] || '—')}</td>`;
    });

    cellsInfo += `<td class="no-print"><button class="btn btn-sm btn-danger" onclick="deleteRecord(${realIdx})">✕</button></td>`;
    trInfo.innerHTML = cellsInfo;
    tbody.appendChild(trInfo);

    // Row 2: Signature and Initials (moving them "under")
    const trSig = document.createElement('tr');
    trSig.classList.add('sig-row-display');

    // Create a container cell for both sig and initials
    const tdSig = document.createElement('td');
    tdSig.colSpan = totalCols;

    let sigContent = `<div class="sig-display-container">`;

    // Add Signature
    sigContent += `<div class="sig-display-item">
      <span class="sig-display-label">Signature:</span>
      <div class="sig-display-box">${r.signature ? `<img src="${r.signature}" alt="sig" />` : '—'}</div>
    </div>`;

    // Add Initials for each date
    if (initCols.length > 0) {
      sigContent += `<div class="init-display-list">
        <span class="sig-display-label">Daily Initials:</span>
        <div class="init-flex-wrap">`;

      initCols.forEach(c => {
        const initImg = r.initialsObj && r.initialsObj[c.dStr];
        sigContent += `<div class="init-display-item">
          <span class="init-date-label">${c.label.replace(' Init', '')}</span>
          <div class="init-display-box">${initImg ? `<img src="${initImg}" alt="init" />` : '—'}</div>
        </div>`;
      });

      sigContent += `</div></div>`;
    }

    // Add attachment if present
    if (r.attachment) {
      const isImage = r.attachment.type && r.attachment.type.startsWith('image/');
      sigContent += `<div class="sig-display-item" style="margin-top:0.5rem;">
        <span class="sig-display-label">📎 Attachment:</span>
        <div class="sig-display-box" style="padding:0.25rem 0.5rem;">
          ${isImage && r.attachment.data
          ? `<img src="${r.attachment.data}" alt="attachment" style="max-height:60px;border-radius:4px;" />`
          : ''
        }
          <a href="${r.attachment.data || '#'}" download="${escHtml(r.attachment.name)}" target="_blank"
             style="color:#C8A951;font-size:0.8rem;display:block;margin-top:0.2rem;">⬇ ${escHtml(r.attachment.name)}</a>
        </div>
      </div>`;
    }

    sigContent += `</div>`;
    tdSig.innerHTML = sigContent;
    trSig.appendChild(tdSig);
    tbody.appendChild(trSig);
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
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── EMAIL ────────────────────────────────────────
function emailSheet() {
  if (records.length === 0) { showToast('⚠️ No sign-in records to email.'); return; }

  const recipient = document.getElementById('emailRecipient').value || 'grants@lacity.org';
  const cc = document.getElementById('emailCC').value || '';
  const title = document.getElementById('displayTitle').textContent;
  const subtitle = document.getElementById('displaySubtitle').textContent;
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const dates = getDatesArray(classConfig.startDate, classConfig.endDate);
  const initCols = dates.map(obj => ({
    dStr: obj.str,
    label: obj.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' Init'
  }));

  const stdLabels = dropdownConfig.map(d => d.label);
  const exLabels = extraFields.map(f => f.label);
  const allLabels = [
    '#', 'Name', 'Time-In',
    ...stdLabels, ...exLabels
  ];

  const classDeets = `\nClass Dates: ${classConfig.startDate || 'TBD'} to ${classConfig.endDate || 'TBD'}  |  Time: ${classConfig.startTime || 'TBD'} to ${classConfig.endTime || 'TBD'}\n`;

  const body = encodeURIComponent(
    `${title} — ${subtitle}\nDate: ${dateStr}${classDeets}Total Sign-Ins: ${records.length}\n\nPlease find the data below (Signatures and Initials are captured digitally):\n\n` +
    allLabels.join(' | ') + '\n' +
    records.map((r, i) => {
      const vals = [
        i + 1,
        r.studentName || '—',
        r.stampedTime ? formatTime(r.stampedTime) : '—'
      ];
      dropdownConfig.forEach(dd => vals.push(r[dd.id] || '—'));
      extraFields.forEach((_, fieldIdx) => vals.push(r[`extra_${fieldIdx}`] || '—'));
      return vals.join(' | ');
    }).join('\n')
  );

  const subject = encodeURIComponent(`${title} — Sign-In Sheet — ${dateStr}`);
  const ccParam = cc ? `&cc=${encodeURIComponent(cc)}` : '';
  const mailto = `mailto:${recipient}?subject=${subject}${ccParam}&body=${body}`;

  window.location.href = mailto;
  showToast('📧 Opening email client…');
}

// ─── EXPORT EXCEL (.xlsx) ─────────────────────────
function exportExcel() {
  if (records.length === 0) { showToast('⚠️ No records to export.'); return; }
  if (typeof XLSX === 'undefined') { showToast('⚠️ Excel library not loaded. Try again.'); return; }

  const dates = getDatesArray(classConfig.startDate, classConfig.endDate);
  const initCols = dates.map(obj => ({
    dStr: obj.str,
    label: obj.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' Init'
  }));

  const stdLabels = dropdownConfig.map(d => d.label);
  const exLabels = extraFields.map(f => f.label);
  const headers = [
    '#', 'Name', 'Time-In',
    ...stdLabels, ...exLabels, 'Has Signature'
  ];
  initCols.forEach(c => headers.push('Has ' + c.label));

  const rows = records.map((r, i) => {
    const row = [
      i + 1,
      r.studentName || '',
      r.stampedTime ? formatTime(r.stampedTime) : ''
    ];
    dropdownConfig.forEach(dd => row.push(r[dd.id] || ''));
    extraFields.forEach((_, fieldIdx) => row.push(r[`extra_${fieldIdx}`] || ''));
    row.push(r.signature ? 'Yes' : 'No');

    initCols.forEach(c => {
      const hasInit = r.initialsObj && r.initialsObj[c.dStr] ? 'Yes' : 'No';
      row.push(hasInit);
    });
    return row;
  });

  const title = document.getElementById('displayTitle').textContent || 'LAFD Sign-In';
  const subtitle = document.getElementById('displaySubtitle').textContent || '';

  const wsData = [
    [title],
    [subtitle],
    [],
    headers,
    ...rows
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Style header row (bold, navy bg) — basic column width
  const colWidths = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sign-In Records');

  const filename = `${title.replace(/[^a-zA-Z0-9 ]/g, '')}-${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast('📊 Excel file downloaded!');
}

// ─── EXPORT CSV ──────────────────────────────────
function exportCSV() {
  if (records.length === 0) { showToast('⚠️ No records to export.'); return; }

  const dates = getDatesArray(classConfig.startDate, classConfig.endDate);
  const initCols = dates.map(obj => ({
    dStr: obj.str,
    label: obj.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' Init'
  }));

  const stdLabels = dropdownConfig.map(d => d.label);
  const exLabels = extraFields.map(f => f.label);
  const headerLabels = [
    '#', 'Name', 'Time-In',
    ...stdLabels, ...exLabels, 'Has Signature'
  ];
  initCols.forEach(c => headerLabels.push('Has ' + c.label));

  const header = headerLabels.join(',');

  const rows = records.map((r, i) => {
    const vals = [
      i + 1,
      `"${(r.studentName || '').replace(/"/g, '""')}"`,
      `"${(r.stampedTime ? formatTime(r.stampedTime) : '').replace(/"/g, '""')}"`
    ];
    dropdownConfig.forEach(dd => vals.push(`"${(r[dd.id] || '').replace(/"/g, '""')}"`));
    extraFields.forEach((_, fieldIdx) => vals.push(`"${(r[`extra_${fieldIdx}`] || '').replace(/"/g, '""')}"`));
    vals.push(r.signature ? '"Yes"' : '"No"');
    initCols.forEach(c => {
      const hasInit = r.initialsObj && r.initialsObj[c.dStr] ? '"Yes"' : '"No"';
      vals.push(hasInit);
    });
    return vals.join(',');
  });

  const title = document.getElementById('displayTitle').textContent || 'LAFD Sign-In';
  const subtitle = document.getElementById('displaySubtitle').textContent || '';

  const csv = [
    `"${title.replace(/"/g, '""')}"`,
    `"${subtitle.replace(/"/g, '""')}"`,
    "",
    header,
    ...rows
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lafd-signin-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('⬇️ CSV downloaded!');
}

// ─── EXPORT PDF ──────────────────────────────────
function exportPDF() {
  if (records.length === 0) { showToast('⚠️ No records to export.'); return; }
  showToast('📄 Generating PDF... Please wait.');

  // Reset scroll to top before adding export styles
  window.scrollTo(0, 0);
  document.body.classList.add('is-pdf-exporting');

  const sheet = document.querySelector('.sheet-container');

  const opt = {
    margin: 0.15, // Small safety margin to prevent edge-cutting
    filename: `lafd-signin-${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: {
      scale: 1.5, // High resolution balance
      useCORS: true,
      logging: false,
      width: 1100,
      windowWidth: 1100,
      scrollY: 0,
      scrollX: 0
    },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape', compress: true }
  };

  // Wait for digital signatures and logo images to settle in the DOM
  setTimeout(() => {
    if (!sheet) {
      document.body.classList.remove('is-pdf-exporting');
      showToast('⚠️ Error: Could not find sign-in sheet.');
      return;
    }

    // Unified call syntax is sometimes more stable across browsers
    html2pdf(sheet, opt).then(() => {
      document.body.classList.remove('is-pdf-exporting');
    }).catch(err => {
      console.error("PDF generation failed:", err);
      document.body.classList.remove('is-pdf-exporting');
      showToast('⚠️ Error generating PDF.');
    });
  }, 2000);
}




// ─── TRAINING QR CODES ───────────────────────────
function openTrainingQR() {
  renderTrainingList();
  document.getElementById('trainingQRModal').classList.remove('hidden');
}
function closeTrainingQRModal() {
  document.getElementById('trainingQRModal').classList.add('hidden');
}
function closeTrainingQROverlay(e) {
  if (e.target.id === 'trainingQRModal') closeTrainingQRModal();
}

function addTraining() {
  const input = document.getElementById('newTrainingName');
  const name = input.value.trim();
  if (!name) return;
  trainings.push({ id: Date.now(), name });
  input.value = '';
  saveTrainings();
  renderTrainingList();
}

function removeTraining(id) {
  trainings = trainings.filter(t => t.id !== id);
  saveTrainings();
  renderTrainingList();
}

function renderTrainingList() {
  const list = document.getElementById('trainingList');
  if (!list) return;
  list.innerHTML = '';

  if (trainings.length === 0) {
    list.innerHTML = '<p class="training-empty">No trainings yet. Add one above.</p>';
    return;
  }

  trainings.forEach(t => {
    const item = document.createElement('div');
    item.className = 'training-item';
    item.innerHTML = `
      <span class="training-name">${escHtml(t.name)}</span>
      <div class="training-actions">
        <button class="btn btn-sm btn-outline" onclick="showTrainingQR(${t.id})">📱 QR Code</button>
        <button class="btn btn-sm btn-danger" onclick="removeTraining(${t.id})">✕</button>
      </div>
    `;
    list.appendChild(item);
  });
}

function showTrainingQR(id) {
  const training = trainings.find(t => t.id === id);
  if (!training) return;

  // Build URL — include ALL current class field values for student pre-fill
  const u = new URL(window.location.href);
  u.search = '';
  u.searchParams.set('role', 'student');
  u.searchParams.set('training', training.name);

  // Capture current form field values so students get them pre-filled
  dropdownConfig.forEach(dd => {
    const el = document.getElementById(`field_${dd.id}`);
    if (el && el.value.trim()) u.searchParams.set(dd.id, el.value.trim());
  });
  extraFields.forEach((f, i) => {
    const el = document.getElementById(`extra_${i}`);
    if (el && el.value.trim()) u.searchParams.set(`extra_${i}`, el.value.trim());
  });

  const url = u.toString();
  _currentQRUrl = url;

  document.getElementById('qrModalTitle').textContent = `📱 ${training.name}`;
  document.getElementById('qrModalDesc').textContent = 'Scan to open the pre-filled sign-in form for this training.';
  document.getElementById('qrUrlDisplay').textContent = url;

  const container = document.getElementById('qrContainer');
  container.innerHTML = '';
  const size = 260;

  if (typeof QRious === 'undefined') {
    container.innerHTML = '<div class="hint" style="color:var(--danger);padding:1rem;">⚠️ QR Library failed to load.</div>';
    document.getElementById('qrModal').classList.remove('hidden');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.id = 'qrImg';
  canvas.style.borderRadius = '8px';
  container.appendChild(canvas);

  try {
    new QRious({ element: canvas, value: url, size, background: 'white', foreground: '#0D1B2A' });
  } catch (e) {
    container.innerHTML = '<div class="hint">⚠️ Could not generate QR code.</div>';
  }

  document.getElementById('qrModal').classList.remove('hidden');
}

function closeQR(e) { if (e.target.id === 'qrModal') closeQRBtn(); }
function closeQRBtn() { document.getElementById('qrModal').classList.add('hidden'); }

function copyQRURL() {
  navigator.clipboard.writeText(_currentQRUrl)
    .then(() => showToast('📋 URL copied!'))
    .catch(() => showToast('⚠️ Could not copy URL.'));
}

function downloadQR() {
  const canvas = document.getElementById('qrImg');
  if (!canvas) return;

  const a = document.createElement('a');
  a.download = 'training-qr.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
  showToast('⬇️ QR code downloaded!');
}

// ─── BACKUP & RESTORE (For Google Drive storage) ──
function exportAppData() {
  const data = {
    dropdowns: dropdownConfig,
    extraFields: extraFields,
    records: records,
    classConfig: classConfig,
    trainings: trainings,
    sheetTitle: localStorage.getItem('lafd_sheetTitle'),
    sheetSubtitle: localStorage.getItem('lafd_sheetSubtitle'),
    logoLeft: localStorage.getItem('lafd_logo_left'),
    logoRight: localStorage.getItem('lafd_logo_right'),
    recipient: localStorage.getItem('lafd_emailRecipient'),
    cc: localStorage.getItem('lafd_emailCC'),
    version: '1.0',
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lafd-signin-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('💾 Backup file downloaded! Save this to Google Drive.');
}

function triggerImport() {
  document.getElementById('importInput').click();
}

function importAppData(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!confirm('This will OVERWRITE all current settings and records with the backup data. Proceed?')) {
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.dropdowns) {
        localStorage.setItem('lafd_dropdowns', JSON.stringify(data.dropdowns));
        localStorage.setItem('lafd_extraFields', JSON.stringify(data.extraFields || []));
        localStorage.setItem('lafd_records', JSON.stringify(data.records || []));
        localStorage.setItem('lafd_classConfig', JSON.stringify(data.classConfig || {}));
        localStorage.setItem('lafd_trainings', JSON.stringify(data.trainings || []));
        if (data.sheetTitle) localStorage.setItem('lafd_sheetTitle', data.sheetTitle);
        if (data.sheetSubtitle) localStorage.setItem('lafd_sheetSubtitle', data.sheetSubtitle);
        if (data.logoLeft) localStorage.setItem('lafd_logo_left', data.logoLeft);
        if (data.logoRight) localStorage.setItem('lafd_logo_right', data.logoRight);
        if (data.recipient) localStorage.setItem('lafd_emailRecipient', data.recipient);
        if (data.cc) localStorage.setItem('lafd_emailCC', data.cc);

        showToast('✅ Data restored. Reloading app...');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        throw new Error("Invalid backup file format.");
      }
    } catch (err) {
      console.error(err);
      showToast('⚠️ Failed to restore. Invalid backup file.');
    }
  };
  reader.readAsText(file);
}


// ─── FILE ATTACHMENT ─────────────────────────────
function handleAttachmentChange(e) {
  const file = e.target.files[0];
  if (!file) { pendingAttachment = null; return; }

  const MAX = 500 * 1024; // 500 KB
  if (file.size > MAX) {
    showToast('⚠️ File too large. Please choose a file under 500KB.');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    pendingAttachment = { name: file.name, type: file.type, data: ev.target.result };
    document.getElementById('attachmentName').textContent = `📎 ${file.name}`;
    const clearBtn = document.getElementById('clearAttachBtn');
    if (clearBtn) clearBtn.style.display = 'inline-flex';
    showToast(`📎 Attached: ${file.name}`);
  };
  reader.readAsDataURL(file);
}

function clearAttachment() {
  pendingAttachment = null;
  const inp = document.getElementById('attachmentInput');
  if (inp) inp.value = '';
  document.getElementById('attachmentName').textContent = '— No file chosen';
  const clearBtn = document.getElementById('clearAttachBtn');
  if (clearBtn) clearBtn.style.display = 'none';
}

// ─── DAY SESSION FILTER ──────────────────────────
function applyDateFilter() {
  const picker = document.getElementById('sessionDateFilter');
  activeDateFilter = picker ? picker.value : null;
  renderTable();
  const countEl = document.getElementById('sessionFilterCount');
  if (countEl && activeDateFilter) {
    const filtered = records.filter(r => matchesDateFilter(r, activeDateFilter));
    countEl.textContent = `${filtered.length} record(s) on ${activeDateFilter}`;
  } else if (countEl) {
    countEl.textContent = '';
  }
}

function clearDateFilter() {
  activeDateFilter = null;
  const picker = document.getElementById('sessionDateFilter');
  if (picker) picker.value = '';
  const countEl = document.getElementById('sessionFilterCount');
  if (countEl) countEl.textContent = '';
  renderTable();
}

function matchesDateFilter(r, dateStr) {
  // Match if the record's Today's Date field equals the filter date
  if (r.date === dateStr) return true;
  // OR if the record has initials for that date
  if (r.initialsObj && r.initialsObj[dateStr]) return true;
  // OR if the record's stampedTime is on that date
  if (r.stampedTime) {
    const d = new Date(r.stampedTime);
    const dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (dStr === dateStr) return true;
  }
  return false;
}

// ─── NEW DAY SESSION ─────────────────────────────
function openNewDaySession() {
  const modal = document.getElementById('newDayModal');
  if (!modal) return;
  // Pre-fill with tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tStr = tomorrow.toISOString().split('T')[0];
  document.getElementById('newDayDate').value = tStr;
  document.getElementById('newDayName').value = `Day ${sessionArchives.length + 2} — ${tStr}`;
  modal.classList.remove('hidden');
}

function closeNewDayModal() {
  document.getElementById('newDayModal').classList.add('hidden');
}

function confirmNewDaySession() {
  const name = document.getElementById('newDayName').value.trim();
  const date = document.getElementById('newDayDate').value;
  if (!name || !date) { showToast('⚠️ Please enter a session name and date.'); return; }

  // Archive current records
  sessionArchives.push({ name, date: date, archivedAt: new Date().toISOString(), records: JSON.parse(JSON.stringify(records)) });
  saveArchives();

  // Keep only unique student info, strip signatures/timestamps for fresh start
  const carryOver = records.map(r => ({
    id: Date.now() + Math.random(),
    studentName: r.studentName,
    // Carry over class fields
    ...Object.fromEntries(dropdownConfig.map(dd => [dd.id, r[dd.id] || ''])),
    initialsObj: {},
    // No signature, timestamp, or initials — fresh for new day
  }));

  records = carryOver;
  saveRecords();

  // Update the class date to match new session
  const dateFieldEl = document.getElementById('field_date');
  if (dateFieldEl) dateFieldEl.value = date;

  closeNewDayModal();
  renderTable();
  showToast(`✅ New session "${name}" started! ${carryOver.length} students carried over.`);
}

function exportDayRoster() {
  const date = activeDateFilter || getTodayStr();
  const filtered = records.filter(r => matchesDateFilter(r, date));
  if (filtered.length === 0) { showToast('⚠️ No records for selected date.'); return; }

  const headers = ['#', 'Name', 'Time-In', ...dropdownConfig.map(d => d.label), 'Signed', 'Initialed'];
  const rows = filtered.map((r, i) => {
    const vals = [i + 1, r.studentName || '—', r.stampedTime ? formatTime(r.stampedTime) : '—'];
    dropdownConfig.forEach(dd => vals.push(r[dd.id] || '—'));
    vals.push(r.signature ? 'Yes' : 'No');
    vals.push(r.initialsObj && r.initialsObj[date] ? 'Yes' : 'No');
    return vals.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `roster-${date}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast(`📄 Day roster exported for ${date}.`);
}

// ─── GOOGLE CLOUD SYNC ───────────────────────────
async function pullCloudRecords() {
  if (!syncUrl) {
    showToast('⚠️ No Sync URL set in Admin.');
    toggleAdmin();
    return;
  }

  const btn = document.getElementById('syncBtn');
  const originalText = btn.textContent;
  btn.textContent = '☁️ Pulling...';
  btn.disabled = true;

  try {
    const res = await fetch(syncUrl);
    if (!res.ok) throw new Error("Could not connect to Google.");
    const remoteRecords = await res.json();

    if (!Array.isArray(remoteRecords)) throw new Error("Invalid data format from Cloud.");

    let addedCount = 0;
    remoteRecords.forEach(remote => {
      // Find matches by name to merge initials
      const matchIdx = records.findIndex(r => (r.studentName || '').toLowerCase() === (remote.studentName || '').toLowerCase());
      if (matchIdx !== -1) {
        // Merge initials from remote into local
        if (remote.initialsObj) {
          records[matchIdx].initialsObj = { ...(records[matchIdx].initialsObj || {}), ...remote.initialsObj };
        }
        // Update signature or stamped time if missing
        if (!records[matchIdx].signature && remote.signature) records[matchIdx].signature = remote.signature;
        if (!records[matchIdx].stampedTime && remote.stampedTime) records[matchIdx].stampedTime = remote.stampedTime;
      } else {
        // NEW Record
        records.push(remote);
        addedCount++;
      }
    });

    saveRecords();
    renderTable();
    showToast(`✅ Synced! Found ${remoteRecords.length} records (${addedCount} new).`);
  } catch (err) {
    console.error(err);
    showToast('⚠️ Could not pull data. Check URL and connection.');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// ─── CLEAR ALL DATA ──────────────────────────────
function clearAllData() {
  if (!confirm('⚠️ CRITICAL: This will delete ALL sign-in records and reset settings. This CANNOT be undone. Proceed?')) return;
  localStorage.clear();
  showToast('🗑️ System reset. Reloading...');
  setTimeout(() => window.location.reload(), 1500);
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
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ══════════════════════════════════════════════
   INLINE SIGNATURE PAD LIBRARY
   Based on signature_pad by Szymon Nowak (MIT)
   Trimmed & adapted for touch + mouse + stylus
══════════════════════════════════════════════ */
class SignaturePad {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.penColor = opts.penColor || '#0D1B2A';
    this.lineWidth = opts.lineWidth || 2.5;
    this.isEmpty_ = true;
    this._points = [];
    this._drawing = false;

    this.ctx.strokeStyle = this.penColor;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this._resizeCanvas();

    canvas.addEventListener('mousedown', this._onDown.bind(this));
    canvas.addEventListener('mousemove', this._onMove.bind(this));
    canvas.addEventListener('mouseup', this._onUp.bind(this));
    canvas.addEventListener('mouseleave', this._onUp.bind(this));
    canvas.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    canvas.addEventListener('touchend', this._onUp.bind(this));
    canvas.addEventListener('touchcancel', this._onUp.bind(this));
  }

  _resizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = this.canvas.offsetWidth || parseInt(this.canvas.getAttribute('width')) || 400;
    const h = this.canvas.offsetHeight || parseInt(this.canvas.getAttribute('height')) || 120;
    this.canvas.width = w * ratio;
    this.canvas.height = h * ratio;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(ratio, ratio);
    this.ctx.strokeStyle = this.penColor;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
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
    this._onDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => { } });
  }
  _onTouchMove(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    this._onMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => { } });
  }

  isEmpty() { return this.isEmpty_; }
  clear() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    this.ctx.clearRect(0, 0, this.canvas.width / ratio, this.canvas.height / ratio);
    this.isEmpty_ = true;
  }
  toDataURL(type) { return this.canvas.toDataURL(type || 'image/png'); }
}
