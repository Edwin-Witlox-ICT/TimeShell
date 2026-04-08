// TimeShell - Template Editor Web UI
// A small HTTP server that serves a visual template editor

const http = require('http');
const fs = require('fs');
const path = require('path');
const { CATEGORIES, DAY_NAMES } = require('./timebox');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const DEFAULT_PORT = 4000;

// ─── API helpers ─────────────────────────────────────────────────────

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Strip trailing commas from JSON (common when hand-editing templates). */
function parseJSON(text) {
  // Remove trailing commas before } or ]
  const cleaned = text.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(cleaned);
}

function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const tpl = parseJSON(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8'));
        const weekTotal = DAY_NAMES.reduce((sum, day) =>
          sum + (tpl.entries || []).reduce((s, e) => s + (e.days?.[day] || 0), 0), 0);
        return {
          filename: f,
          name: tpl.name || f.replace('.json', ''),
          description: tpl.description || '',
          entries: (tpl.entries || []).length,
          weekTotal,
        };
      } catch {
        return { filename: f, name: f, description: '(invalid)', entries: 0, weekTotal: 0 };
      }
    });
}

function loadTemplate(filename) {
  const filepath = path.join(TEMPLATES_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  return parseJSON(fs.readFileSync(filepath, 'utf8'));
}

function saveTemplate(filename, data) {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
  const filepath = path.join(TEMPLATES_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');
}

// ─── HTTP Server ─────────────────────────────────────────────────────

function createServer(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    // CORS headers (for dev convenience)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // API routes
      if (pathname === '/api/templates' && req.method === 'GET') {
        return jsonResponse(res, 200, listTemplates());
      }

      if (pathname === '/api/categories' && req.method === 'GET') {
        return jsonResponse(res, 200, CATEGORIES);
      }

      const templateMatch = pathname.match(/^\/api\/templates\/(.+)$/);
      if (templateMatch) {
        const filename = decodeURIComponent(templateMatch[1]);
        if (!filename.endsWith('.json')) {
          return jsonResponse(res, 400, { error: 'Filename must end with .json' });
        }

        if (req.method === 'GET') {
          const tpl = loadTemplate(filename);
          if (!tpl) return jsonResponse(res, 404, { error: 'Template not found' });
          return jsonResponse(res, 200, tpl);
        }

        if (req.method === 'PUT') {
          const body = await readBody(req);
          saveTemplate(filename, body);
          return jsonResponse(res, 200, { ok: true });
        }

        if (req.method === 'DELETE') {
          const filepath = path.join(TEMPLATES_DIR, filename);
          if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
          return jsonResponse(res, 200, { ok: true });
        }
      }

      // Serve the frontend
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHTML());
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      console.error('Server error:', err);
      jsonResponse(res, 500, { error: err.message });
    }
  });

  server.listen(port, () => {
    console.log(`Template editor running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop.\n');
  });

  return server;
}

// ─── Frontend HTML ───────────────────────────────────────────────────

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TimeShell - Template Editor</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #7d8590;
    --accent: #58a6ff;
    --accent-hover: #79c0ff;
    --green: #3fb950;
    --red: #f85149;
    --orange: #d29922;
    --input-bg: #0d1117;
    --row-hover: #1c2129;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    padding: 0;
  }

  /* ── Header ── */
  .header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .header h1 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }
  .header h1 span { color: var(--text-muted); font-weight: 400; }

  /* ── Layout ── */
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }

  /* ── Template selector ── */
  .template-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .template-bar label { color: var(--text-muted); font-size: 14px; }
  .template-bar select, .template-bar input {
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 6px 10px;
    font-size: 14px;
  }
  .template-bar select:focus, .template-bar input:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* ── Buttons ── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .btn:hover { background: var(--row-hover); border-color: var(--text-muted); }
  .btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
  .btn-primary:hover { background: #2ea043; }
  .btn-danger { color: var(--red); }
  .btn-danger:hover { background: #2d1214; border-color: var(--red); }
  .btn-sm { padding: 3px 8px; font-size: 12px; }

  /* ── Meta fields ── */
  .meta {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 10px;
    margin-bottom: 20px;
    max-width: 500px;
  }
  .meta label { color: var(--text-muted); font-size: 13px; align-self: center; }
  .meta input {
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 6px 10px;
    font-size: 14px;
  }
  .meta input:focus { outline: none; border-color: var(--accent); }

  /* ── Grid table ── */
  .grid-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  thead th {
    text-align: left;
    padding: 10px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    position: sticky;
    top: 0;
  }
  thead th.day-col { text-align: center; min-width: 60px; }
  thead th.total-col { text-align: center; min-width: 60px; color: var(--accent); }

  tbody tr { border-bottom: 1px solid var(--border); }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--row-hover); }

  td { padding: 6px 8px; vertical-align: middle; }
  td input, td select {
    width: 100%;
    background: var(--input-bg);
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text);
    padding: 5px 8px;
    font-size: 13px;
    font-family: inherit;
  }
  td input:hover, td select:hover { border-color: var(--border); }
  td input:focus, td select:focus { outline: none; border-color: var(--accent); background: #010409; }

  td.day-cell input {
    text-align: center;
    width: 60px;
    font-variant-numeric: tabular-nums;
  }
  td.day-cell input.has-value { color: var(--green); font-weight: 600; }

  td.total-cell {
    text-align: center;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  td.actions-cell { text-align: center; white-space: nowrap; min-width: 70px; }

  /* ── Weekend toggle ── */
  .hide-weekend .weekend-col { display: none; }

  /* ── Footer totals ── */
  tfoot td {
    padding: 10px 12px;
    border-top: 2px solid var(--border);
    font-weight: 600;
    font-size: 13px;
    color: var(--text-muted);
  }
  tfoot td.day-total {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  tfoot td.day-total.over { color: var(--red); }
  tfoot td.day-total.ok { color: var(--green); }
  tfoot td.week-total {
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
    font-size: 14px;
  }

  /* ── Toast notification (fixed top-right) ── */
  .toast {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 9999;
    font-size: 14px;
    font-weight: 600;
    padding: 12px 20px;
    border-radius: 8px;
    pointer-events: none;
    opacity: 0;
    transform: translateX(20px);
    transition: opacity 0.3s, transform 0.3s;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .toast.visible {
    opacity: 1;
    transform: translateX(0);
  }
  .toast.success {
    color: var(--green);
    background: #0d2818;
    border: 1px solid #238636;
  }
  .toast.error {
    color: var(--red);
    background: #2d1214;
    border: 1px solid #f85149;
  }

  /* ── Status bar (week summary only) ── */
  .status-bar {
    margin-top: 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .week-summary {
    font-size: 13px;
    color: var(--text-muted);
    margin-left: auto;
  }
  .week-summary strong { color: var(--text); }

  /* ── Keyboard hint ── */
  .hint {
    margin-top: 20px;
    font-size: 12px;
    color: var(--text-muted);
  }
  kbd {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
    font-family: inherit;
  }
</style>
</head>
<body>

<div class="header">
  <h1>TimeShell <span>Template Editor</span></h1>
</div>

<div class="container">
  <!-- Template selector -->
  <div class="template-bar">
    <label for="tpl-select">Template:</label>
    <select id="tpl-select"></select>
    <button class="btn btn-primary" id="btn-save">Save</button>
    <button class="btn" id="btn-add-entry">+ Add Entry</button>
    <button class="btn" id="btn-new-tpl">New Template</button>
    <button class="btn" id="btn-dup-tpl">Duplicate Template</button>
    <button class="btn" id="btn-toggle-weekend">Hide Weekend</button>
  </div>

  <!-- Meta fields -->
  <div class="meta">
    <label for="tpl-name">Name</label>
    <input id="tpl-name" type="text" placeholder="Template name">
    <label for="tpl-desc">Description</label>
    <input id="tpl-desc" type="text" placeholder="Optional description">
  </div>

  <!-- Entry grid -->
  <div class="grid-wrap">
    <table>
      <thead>
        <tr>
          <th style="min-width:100px">Jira ID</th>
          <th style="min-width:100px">Category</th>
          <th style="min-width:160px">Comment</th>
          <th class="day-col">Mon</th>
          <th class="day-col">Tue</th>
          <th class="day-col">Wed</th>
          <th class="day-col">Thu</th>
          <th class="day-col">Fri</th>
          <th class="day-col weekend-col" data-day="sat">Sat</th>
          <th class="day-col weekend-col" data-day="sun">Sun</th>
          <th class="total-col">Total</th>
          <th style="width:40px"></th>
        </tr>
      </thead>
      <tbody id="entries-body"></tbody>
      <tfoot>
        <tr id="totals-row">
          <td colspan="3" style="text-align:right">Daily totals</td>
          <td class="day-total" id="total-mon">-</td>
          <td class="day-total" id="total-tue">-</td>
          <td class="day-total" id="total-wed">-</td>
          <td class="day-total" id="total-thu">-</td>
          <td class="day-total" id="total-fri">-</td>
          <td class="day-total weekend-col" id="total-sat">-</td>
          <td class="day-total weekend-col" id="total-sun">-</td>
          <td class="week-total" id="total-week">-</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Status bar -->
  <div class="status-bar">
    <span class="week-summary" id="week-summary"></span>
  </div>

  <!-- Fixed toast notification -->
  <div class="toast" id="toast"></div>

  <div class="hint">
    <kbd>Tab</kbd> between cells &middot;
    <kbd>Ctrl+S</kbd> save &middot;
    Enter hours as numbers (0 or empty = no booking)
  </div>
</div>

<script>
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
let categories = {};
let currentFile = null;
let template = null;
let dirty = false;

// ── API ──
async function api(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

async function loadCategories() {
  categories = await api('/api/categories');
}

async function loadTemplateList() {
  const list = await api('/api/templates');
  const sel = document.getElementById('tpl-select');
  sel.innerHTML = '';
  if (list.length === 0) {
    sel.innerHTML = '<option value="">(no templates)</option>';
    return;
  }
  for (const t of list) {
    const opt = document.createElement('option');
    opt.value = t.filename;
    opt.textContent = t.name + ' (' + t.weekTotal + 'h)';
    sel.appendChild(opt);
  }
  return list;
}

async function loadTemplate(filename) {
  template = await api('/api/templates/' + encodeURIComponent(filename));
  currentFile = filename;
  document.getElementById('tpl-name').value = template.name || '';
  document.getElementById('tpl-desc').value = template.description || '';
  renderEntries();
  dirty = false;
}

async function saveTemplate() {
  if (!currentFile || !template) return;
  template.name = document.getElementById('tpl-name').value.trim();
  template.description = document.getElementById('tpl-desc').value.trim();
  readEntriesFromDOM();
  await api('/api/templates/' + encodeURIComponent(currentFile), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  });
  dirty = false;
  showStatus('Template "' + currentFile + '" saved to disk.', 'success');
  loadTemplateList();
}

// ── Rendering ──
function categoryOptions(selected) {
  let html = '<option value="">--</option>';
  for (const [code, desc] of Object.entries(categories)) {
    const sel = code === selected ? ' selected' : '';
    html += '<option value="' + code + '"' + sel + '>' + code + ' - ' + desc + '</option>';
  }
  return html;
}

function renderEntries() {
  const tbody = document.getElementById('entries-body');
  tbody.innerHTML = '';
  if (!template || !template.entries) return;

  for (let i = 0; i < template.entries.length; i++) {
    const e = template.entries[i];
    const tr = document.createElement('tr');
    tr.dataset.index = i;

    // Jira ID
    tr.innerHTML = '<td><input type="text" class="field-jiraId" value="' + esc(e.jiraId || '') + '" placeholder="PROJ-123"></td>';
    // Category
    tr.innerHTML += '<td><select class="field-category">' + categoryOptions(e.category) + '</select></td>';
    // Comment
    tr.innerHTML += '<td><input type="text" class="field-comment" value="' + esc(e.comment || '') + '" placeholder="Optional"></td>';
    // Day cells
    let rowTotal = 0;
    for (const day of DAYS) {
      const h = e.days?.[day] || 0;
      rowTotal += h;
      const cls = h > 0 ? 'has-value' : '';
      const weekendCls = (day === 'sat' || day === 'sun') ? ' weekend-col' : '';
      tr.innerHTML += '<td class="day-cell' + weekendCls + '"><input type="number" min="0" max="24" step="0.25" class="field-day ' + cls + '" data-day="' + day + '" value="' + (h || '') + '"></td>';
    }
    // Row total
    tr.innerHTML += '<td class="total-cell row-total">' + (rowTotal || '-') + '</td>';
    // Action buttons
    tr.innerHTML += '<td class="actions-cell"><button class="btn btn-sm btn-spread" title="Spread total evenly over Mon-Fri">=</button> <button class="btn btn-danger btn-sm btn-delete" title="Remove entry">x</button></td>';

    tbody.appendChild(tr);
  }

  // Bind events
  tbody.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', onCellChange);
  });
  tbody.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', onDeleteEntry);
  });
  tbody.querySelectorAll('.btn-spread').forEach((btn) => {
    btn.addEventListener('click', onSpreadEvenly);
  });

  updateTotals();
}

function onCellChange(e) {
  dirty = true;
  const el = e.target;
  if (el.classList.contains('field-day')) {
    el.classList.toggle('has-value', el.value && parseFloat(el.value) > 0);
  }
  // Update row total
  const tr = el.closest('tr');
  let rowSum = 0;
  tr.querySelectorAll('.field-day').forEach((inp) => {
    rowSum += parseFloat(inp.value) || 0;
  });
  tr.querySelector('.row-total').textContent = rowSum || '-';
  updateTotals();
}

function updateTotals() {
  let weekTotal = 0;
  for (const day of DAYS) {
    let daySum = 0;
    document.querySelectorAll('.field-day[data-day="' + day + '"]').forEach((inp) => {
      daySum += parseFloat(inp.value) || 0;
    });
    const cell = document.getElementById('total-' + day);
    cell.textContent = daySum || '-';
    cell.className = 'day-total';
    if (daySum > 0 && daySum <= 8) cell.classList.add('ok');
    else if (daySum > 10) cell.classList.add('over');
    weekTotal += daySum;
  }

  document.getElementById('total-week').textContent = weekTotal || '-';
  document.getElementById('week-summary').innerHTML =
    'Week total: <strong>' + weekTotal + 'h</strong>' +
    (weekTotal === 40 ? ' (full week)' : weekTotal > 40 ? ' (overtime!)' : '');
}

function readEntriesFromDOM() {
  const rows = document.querySelectorAll('#entries-body tr');
  template.entries = [];
  rows.forEach((tr) => {
    const entry = {
      jiraId: tr.querySelector('.field-jiraId').value.trim(),
      category: tr.querySelector('.field-category').value,
      comment: tr.querySelector('.field-comment').value.trim(),
      days: {},
    };
    for (const day of DAYS) {
      const v = parseFloat(tr.querySelector('.field-day[data-day="' + day + '"]').value) || 0;
      if (v > 0) entry.days[day] = v;
    }
    template.entries.push(entry);
  });
}

function onDeleteEntry(e) {
  const tr = e.target.closest('tr');
  const idx = parseInt(tr.dataset.index, 10);
  readEntriesFromDOM();
  template.entries.splice(idx, 1);
  renderEntries();
  dirty = true;
}

function onSpreadEvenly(e) {
  const tr = e.target.closest('tr');
  // Sum all current day values in this row
  let total = 0;
  tr.querySelectorAll('.field-day').forEach((inp) => {
    total += parseFloat(inp.value) || 0;
  });
  if (total <= 0) return;
  const perDay = Math.round((total / 5) * 100) / 100; // round to 2 decimals
  const workdays = ['mon','tue','wed','thu','fri'];
  tr.querySelectorAll('.field-day').forEach((inp) => {
    const day = inp.dataset.day;
    if (workdays.includes(day)) {
      inp.value = perDay;
      inp.classList.add('has-value');
    } else {
      inp.value = '';
      inp.classList.remove('has-value');
    }
  });
  // Update row total
  const rowTotal = perDay * 5;
  tr.querySelector('.row-total').textContent = rowTotal || '-';
  updateTotals();
  dirty = true;
}

function addEntry() {
  if (!template) return;
  readEntriesFromDOM();
  template.entries.push({ jiraId: '', category: '', comment: '', days: {} });
  renderEntries();
  dirty = true;
  // Focus the new row's jira ID field
  const rows = document.querySelectorAll('#entries-body tr');
  const last = rows[rows.length - 1];
  if (last) last.querySelector('.field-jiraId').focus();
}

async function newTemplate() {
  const name = prompt('Template name (no .json):');
  if (!name) return;
  const filename = name.replace(/\\.json$/, '') + '.json';
  const tpl = { name, description: '', entries: [{ jiraId: '', category: '', comment: '', days: {} }] };
  await api('/api/templates/' + encodeURIComponent(filename), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tpl),
  });
  await loadTemplateList();
  document.getElementById('tpl-select').value = filename;
  await loadTemplate(filename);
  showStatus('Created ' + filename, 'success');
}

async function duplicateTemplate() {
  if (!currentFile || !template) return;
  readEntriesFromDOM();
  // Generate a unique name with a "-copy", "-copy-2", etc. suffix
  const baseName = (template.name || currentFile.replace('.json', '')).replace(/-copy(-\\d+)?$/, '');
  const existingFiles = Array.from(document.getElementById('tpl-select').options).map(o => o.value);
  let suffix = '-copy';
  let n = 1;
  let filename = baseName + suffix + '.json';
  while (existingFiles.includes(filename)) {
    n++;
    suffix = '-copy-' + n;
    filename = baseName + suffix + '.json';
  }
  const newName = baseName + suffix;
  const dup = JSON.parse(JSON.stringify(template));
  dup.name = newName;
  dup.description = (dup.description || '') ? dup.description + ' (copy)' : 'Copy of ' + template.name;
  await api('/api/templates/' + encodeURIComponent(filename), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dup),
  });
  await loadTemplateList();
  document.getElementById('tpl-select').value = filename;
  await loadTemplate(filename);
  showStatus('Duplicated as ' + filename, 'success');
}

function showStatus(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = (type === 'success' ? 'OK -- ' : '') + msg;
  el.className = 'toast ' + type;
  // Trigger reflow then show
  void el.offsetWidth;
  el.classList.add('visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove('visible');
  }, 4000);
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();
  const list = await loadTemplateList();
  if (list && list.length > 0) {
    await loadTemplate(list[0].filename);
  }

  document.getElementById('tpl-select').addEventListener('change', (e) => {
    if (e.target.value) loadTemplate(e.target.value);
  });

  document.getElementById('btn-save').addEventListener('click', saveTemplate);
  document.getElementById('btn-add-entry').addEventListener('click', addEntry);
  document.getElementById('btn-new-tpl').addEventListener('click', newTemplate);
  document.getElementById('btn-dup-tpl').addEventListener('click', duplicateTemplate);

  // Weekend toggle
  const weekendBtn = document.getElementById('btn-toggle-weekend');
  let weekendHidden = true;
  document.querySelector('table').classList.add('hide-weekend');
  weekendBtn.textContent = 'Show Weekend';
  weekendBtn.addEventListener('click', () => {
    weekendHidden = !weekendHidden;
    document.querySelector('table').classList.toggle('hide-weekend', weekendHidden);
    weekendBtn.textContent = weekendHidden ? 'Show Weekend' : 'Hide Weekend';
  });

  // Ctrl+S
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveTemplate();
    }
  });

  // Warn on unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
});
</script>
</body>
</html>`;
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = { createServer, DEFAULT_PORT };

// Run directly
if (require.main === module) {
  const port = parseInt(process.argv[2], 10) || DEFAULT_PORT;
  createServer(port);
}
