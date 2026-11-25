/* ==========================================================================
   StreetSense operations desk
   Incident register, live map, work orders, analytics and community inbox.
   Works offline against browser storage; syncs to the SQLite backend when an
   administrator is signed in. All model output stays "pending human review".
   ========================================================================== */
'use strict';

const CITY_CENTER = [28.6139, 77.2090];
const DEFAULT_ZOOM = 12;
const STORE_KEY = 'streetsense-ops-v3';
const THEME_KEY = 'streetsense-theme-v1';
const PROMOTED_KEY = 'streetsense-promoted-v1';

const TYPES = ['Pothole', 'Road crack', 'Damaged sign', 'Broken streetlight', 'Blocked drain', 'Other'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const INCIDENT_STATUSES = ['Open', 'Assigned', 'In progress', 'Resolved'];
const ORDER_STATUSES = ['New', 'Assigned', 'In progress', 'Resolved'];
const TEAMS = ['Unassigned', 'Roads Unit 01', 'Roads Unit 02', 'Roads Unit 03', 'Roads Unit 04', 'Signage Team 02', 'Electrical Unit 01', 'Drainage Unit 01', 'Road Marking 03'];
const SEV_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const SEV_WEIGHT = { Critical: 4, High: 3, Medium: 2, Low: 1 };
const RISK_DEFAULT = { Critical: 95, High: 82, Medium: 55, Low: 27 };
const TYPE_ICON = { 'Pothole': 'pothole', 'Road crack': 'crack', 'Damaged sign': 'sign', 'Broken streetlight': 'light', 'Blocked drain': 'drain', 'Other': 'other' };
const ORDER_TO_INCIDENT = { 'New': 'Open', 'Assigned': 'Assigned', 'In progress': 'In progress', 'Resolved': 'Resolved' };
const INCIDENT_TO_ORDER = { 'Open': 'New', 'Assigned': 'Assigned', 'In progress': 'In progress', 'Resolved': 'Resolved' };
const CATEGORY_TO_TYPE = {
  'pothole': 'Pothole', 'road crack': 'Road crack', 'road edge damage': 'Road crack', 'waterlogging': 'Blocked drain',
  'damaged road marking': 'Other', 'damaged sign': 'Damaged sign', 'broken streetlight': 'Broken streetlight', 'blocked drain': 'Blocked drain'
};
const FALLBACK_POINTS = [[28.6206, 77.2104], [28.6252, 77.2001], [28.6065, 77.2221], [28.5892, 77.2164], [28.6411, 77.2252], [28.5784, 77.2358]];

/* ---------- Illustrative seed records (flagged as sample everywhere) ---------- */
function seedIncidents() {
  return [
    { id: 'SS-2048', type: 'Pothole', severity: 'Critical', location: 'Lajpat Nagar II · Central Market Road', lat: 28.5677, lng: 77.2433, reported: '8 min ago', confidence: 96.2, status: 'Open', source: 'Dashcam upload', description: 'Large road-surface depression near a pedestrian crossing. Requires field verification and temporary barricading.', team: 'Unassigned', risk: 94, sample: true },
    { id: 'SS-2047', type: 'Damaged sign', severity: 'High', location: 'Connaught Place · Block B', lat: 28.6315, lng: 77.2167, reported: '21 min ago', confidence: 91.4, status: 'Assigned', source: 'Mobile photo', description: 'Bent and partially obstructed directional sign. Visibility may be reduced for approaching drivers.', team: 'Signage Team 02', risk: 82, sample: true },
    { id: 'SS-2046', type: 'Broken streetlight', severity: 'High', location: 'Karol Bagh · Ajmal Khan Road', lat: 28.6514, lng: 77.1907, reported: '46 min ago', confidence: 94.8, status: 'In progress', source: 'Field report', description: 'Streetlight reported non-functional along a busy evening route. Electrical inspection required.', team: 'Electrical Unit 01', risk: 79, sample: true },
    { id: 'SS-2045', type: 'Road crack', severity: 'Medium', location: 'Saket · Press Enclave Road', lat: 28.5245, lng: 77.2066, reported: '1 hr ago', confidence: 88.7, status: 'Open', source: 'Dashcam upload', description: 'Linear surface cracking visible across part of the carriageway. Monitor for progression.', team: 'Unassigned', risk: 56, sample: true },
    { id: 'SS-2044', type: 'Pothole', severity: 'Low', location: 'India Gate · C-Hexagon', lat: 28.6129, lng: 77.2295, reported: '2 hr ago', confidence: 86.1, status: 'Resolved', source: 'Mobile photo', description: 'Small surface defect recorded for maintenance history. Repair marked complete in this sample.', team: 'Roads Unit 03', risk: 28, sample: true }
  ];
}
function seedOrders() {
  return [
    { id: 'WO-8041', title: 'Repair deep road-surface defect', incident: 'SS-2048', location: 'Lajpat Nagar II', priority: 'Critical', status: 'New', team: 'Unassigned', due: 'Today', sample: true },
    { id: 'WO-8040', title: 'Replace damaged direction sign', incident: 'SS-2047', location: 'Connaught Place', priority: 'High', status: 'Assigned', team: 'Signage Team 02', due: 'Today', sample: true },
    { id: 'WO-8039', title: 'Inspect streetlight circuit', incident: 'SS-2046', location: 'Karol Bagh', priority: 'High', status: 'In progress', team: 'Electrical Unit 01', due: 'Tomorrow', sample: true },
    { id: 'WO-8038', title: 'Assess road-surface cracking', incident: 'SS-2045', location: 'Saket', priority: 'Medium', status: 'New', team: 'Unassigned', due: 'In 2 days', sample: true },
    { id: 'WO-8037', title: 'Patch minor surface damage', incident: 'SS-2044', location: 'India Gate', priority: 'Low', status: 'Resolved', team: 'Roads Unit 03', due: 'Complete', sample: true }
  ];
}
const SEED_INCIDENT_IDS = new Set(seedIncidents().map(x => x.id));
const SEED_ORDER_IDS = new Set(seedOrders().map(x => x.id));
const incidents = seedIncidents();
const workOrders = seedOrders();

/* ---------- State ---------- */
let maps = { mini: null, full: null };
let markerLayers = { mini: null, full: null };
let markerIndex = { mini: {}, full: {} };
let currentMapFilter = 'all';
let currentDetailId = null;
let activeView = 'overview';
let selectedFile = null;
let selectedPreviewUrl = null;
let uploadBusy = false;
let me = null;
let isAdmin = false;
let complaints = [];
let inboxError = '';
let inboxLoaded = false;
let evidenceItems = [];
let promoted = {};
let lastFocus = null;
let paletteIndex = 0;
let paletteItems = [];
let saveTimer = null;

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (v = '') => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const slug = (v = '') => String(v).toLowerCase().replace(/\s+/g, '-');
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="icons.svg#i-${name}"/></svg>`;
const plate = (id) => `<span class="plate">${esc(id)}</span>`;
const sevBadge = (s) => `<span class="sev s-${slug(s)}"><b class="bars"><i></i><i></i><i></i><i></i></b>${esc(s)}</span>`;
const stBadge = (s) => `<span class="st st-${slug(s)}">${esc(s)}</span>`;
const shortLocation = (v = '') => {
  const first = String(v).split(' · ')[0];
  return /^(GPS location|Location not provided)/i.test(first) ? 'Unlocated' : first;
};
const isSample = (item) => item.sample === true || SEED_INCIDENT_IDS.has(item.id);
const sampleTag = (item) => (isSample(item) ? '<span class="tag-sample">Sample</span>' : '');
const backend = () => window.streetSenseBackend;
const orderFor = (incidentId) => workOrders.find(w => w.incident === incidentId);
const riskOf = (item) => (Number.isFinite(Number(item.risk)) ? item.risk : RISK_DEFAULT[item.severity] ?? 40);

function rel(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const reportedLabel = (item) => (item.createdAt ? rel(item.createdAt) : item.reported || '—');

async function api(path, options = {}) {
  const r = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

function toast(message, ico = 'check') {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon(ico, 'i-sm')}<span>${esc(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 220); }, 3600);
}

function sortedIncidents() {
  return [...incidents].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.id.localeCompare(a.id, undefined, { numeric: true }));
}
function openIncidents() { return incidents.filter(x => x.status !== 'Resolved'); }

/* ---------- Persistence ---------- */
function restoreLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.version === 3 && Array.isArray(saved.incidents) && Array.isArray(saved.workOrders)
        && saved.incidents.every(x => x && typeof x.id === 'string' && typeof x.type === 'string')
        && saved.workOrders.every(x => x && typeof x.id === 'string' && typeof x.status === 'string')) {
        incidents.splice(0, incidents.length, ...saved.incidents);
        workOrders.splice(0, workOrders.length, ...saved.workOrders);
      }
    }
    promoted = JSON.parse(localStorage.getItem(PROMOTED_KEY) || '{}') || {};
  } catch (e) { console.warn('Saved workspace could not be restored:', e); }
}
function setPill(text, title) {
  const pill = $('save-pill');
  if (!pill) return;
  pill.textContent = text;
  if (title) pill.title = title;
}
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ version: 3, savedAt: new Date().toISOString(), incidents, workOrders }));
    localStorage.setItem(PROMOTED_KEY, JSON.stringify(promoted));
    if (!backend()?.online) setPill('Saved on this device', 'Changes are stored in this browser only.');
  } catch (e) {
    toast('This browser blocked local saving.', 'close');
  }
  if (backend()?.online) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(syncServer, 250);
  }
}
let snapshotVersion = null;
async function syncServer() {
  try {
    const res = await backend().saveSnapshot(incidents, workOrders, snapshotVersion);
    if (res && res.version) snapshotVersion = res.version;
    if (res && (res.merged || res.conflict)) {
      incidents.splice(0, incidents.length, ...res.incidents); workOrders.splice(0, workOrders.length, ...res.workOrders); updateAll();
      toast(res.conflict ? 'Another window changed this data. It was reloaded, so please repeat your last edit.' : 'Saved. Changes made elsewhere were merged in.', 'close');
    }
    setPill('Synced to server', 'Incident and work-order data is saved in the SQLite register.');
  } catch (e) {
    console.error('Server sync failed:', e);
    setPill('Sync failed · local copy kept', e.message);
  }
}

/* ---------- Data actions ---------- */
function nextNumber(list, prefix, min) {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  return Math.max(min - 1, ...list.map(x => { const m = re.exec(x.id); return m ? Number(m[1]) : 0; })) + 1;
}

function makeReport({ type, severity, location, lat, lng, description, source = 'Field report', confidence = null, preview = false, evidenceId = null, image = null, complaintId = null }) {
  const nLat = Number(lat), nLng = Number(lng);
  const hasCoords = lat !== '' && lat !== null && lng !== '' && lng !== null && Number.isFinite(nLat) && Number.isFinite(nLng)
    && nLat >= -90 && nLat <= 90 && nLng >= -180 && nLng <= 180 && !(nLat === 0 && nLng === 0);
  const fallback = FALLBACK_POINTS[incidents.length % FALLBACK_POINTS.length];
  const item = {
    id: `SS-${nextNumber(incidents, 'SS', 2049)}`,
    type: TYPES.includes(type) ? type : 'Other',
    severity: SEVERITIES.includes(severity) ? severity : 'Medium',
    location: String(location || 'Location not provided').trim().slice(0, 240) || 'Location not provided',
    lat: hasCoords ? nLat : fallback[0], lng: hasCoords ? nLng : fallback[1],
    reported: 'Just now', createdAt: new Date().toISOString(),
    confidence, status: 'Open', source, team: 'Unassigned',
    description: description || 'New observation added to the incident register.',
    risk: RISK_DEFAULT[severity] ?? 55, preview, approximate: !hasCoords, evidenceId
  };
  if (image) item.image = image;
  if (complaintId) item.complaintId = complaintId;
  incidents.unshift(item);
  return item;
}

function addWorkOrder({ incidentId, title, team = 'Unassigned', due = '' }) {
  const inc = incidents.find(x => x.id === incidentId);
  if (!inc) return null;
  if (orderFor(incidentId)) { toast(`A work order already exists for ${incidentId}.`, 'link'); return null; }
  const order = {
    id: `WO-${nextNumber(workOrders, 'WO', 8042)}`,
    title: (title || `${inc.type} — ${shortLocation(inc.location)}`).slice(0, 120),
    incident: inc.id, location: shortLocation(inc.location), priority: inc.severity,
    status: team !== 'Unassigned' ? 'Assigned' : 'New', team, due: due || 'Unscheduled'
  };
  workOrders.unshift(order);
  syncIncidentFromOrder(order);
  return order;
}

function syncIncidentFromOrder(order) {
  const inc = incidents.find(x => x.id === order.incident);
  if (!inc) return;
  inc.status = ORDER_TO_INCIDENT[order.status] || inc.status;
  inc.team = order.team || 'Unassigned';
}

function setOrderStatus(id, status) {
  const order = workOrders.find(w => w.id === id);
  if (!order || !ORDER_STATUSES.includes(status) || order.status === status) return;
  order.status = status;
  if (status === 'Resolved') order.due = 'Complete';
  syncIncidentFromOrder(order);
  commit(`${order.id} moved to ${status}.`);
}
function setOrderTeam(id, team) {
  const order = workOrders.find(w => w.id === id);
  if (!order || !TEAMS.includes(team)) return;
  order.team = team;
  if (team !== 'Unassigned' && order.status === 'New') order.status = 'Assigned';
  syncIncidentFromOrder(order);
  commit(team === 'Unassigned' ? `${order.id} released.` : `${order.id} assigned to ${team}.`);
}

function saveIncidentEdits() {
  const item = incidents.find(x => x.id === currentDetailId);
  if (!item) return;
  const severity = $('detail-severity').value, status = $('detail-status').value;
  item.severity = SEVERITIES.includes(severity) ? severity : item.severity;
  item.risk = RISK_DEFAULT[item.severity] ?? item.risk;
  item.status = INCIDENT_STATUSES.includes(status) ? status : item.status;
  const order = orderFor(item.id);
  if (order) {
    order.priority = item.severity;
    order.status = INCIDENT_TO_ORDER[item.status];
    if (order.status === 'Resolved') order.due = 'Complete';
  }
  closeModals();
  commit(`${item.id} updated.`);
}

function deleteIncident(id) {
  const item = incidents.find(x => x.id === id);
  if (!item) return;
  if (!window.confirm(`Delete ${id} and any linked work order? This cannot be undone.`)) return;
  incidents.splice(incidents.indexOf(item), 1);
  for (let i = workOrders.length - 1; i >= 0; i--) if (workOrders[i].incident === id) workOrders.splice(i, 1);
  closeModals();
  commit(`${id} deleted.`);
}

function commit(message) {
  updateAll();
  saveState();
  if (message) toast(message);
}

/* ---------- Rendering: shared ---------- */
function updateAll() {
  renderNavCounts();
  renderBrief();
  renderLedger();
  renderLegend();
  renderQueue();
  renderReports();
  renderMapList();
  renderPipeline();
  renderMix('mix-list');
  renderAnalytics();
  renderNotifications();
  renderMapMarkers('mini');
  renderMapMarkers('full');
  renderOrders();
  renderInboxBadge();
  if (activeView === 'inbox') renderInbox();
}

function renderNavCounts() {
  $('report-count').textContent = incidents.length;
  const live = workOrders.filter(w => w.status !== 'Resolved').length;
  $('wo-count').textContent = live;
  $('wo-count').classList.toggle('hidden', live === 0);
}

function renderBrief() {
  $('brief-date').textContent = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const open = openIncidents(), crit = open.filter(x => x.severity === 'Critical');
  let headline;
  if (!incidents.length) headline = 'No incidents logged yet.';
  else if (!open.length) headline = 'All clear. Every logged issue is resolved.';
  else if (crit.length) headline = `${crit.length} critical ${crit.length === 1 ? 'issue needs' : 'issues need'} a crew today.`;
  else headline = `${open.length} open ${open.length === 1 ? 'issue' : 'issues'}, none critical.`;
  $('brief-headline').textContent = headline;
  const top = sortedIncidents().find(x => x.status !== 'Resolved');
  const waiting = incidents.filter(x => x.status === 'Open').length;
  const active = workOrders.filter(w => w.status === 'In progress').length;
  $('brief-body').textContent = top
    ? `Highest risk is the ${top.type.toLowerCase()} at ${shortLocation(top.location)} (${top.id}). ${waiting} ${waiting === 1 ? 'issue is' : 'issues are'} awaiting assignment and ${active} ${active === 1 ? 'repair is' : 'repairs are'} under way.`
    : 'Log a field report or add a street photo to start the register.';
}

function renderLedger() {
  const open = openIncidents(), total = incidents.length;
  const resolved = total - open.length;
  const pct = total ? Math.round(resolved / total * 100) : 0;
  $('stat-open').textContent = open.length;
  $('stat-open-note').textContent = `of ${total} logged`;
  $('stat-critical').textContent = open.filter(x => x.severity === 'Critical').length;
  $('stat-unassigned').textContent = incidents.filter(x => x.status === 'Open').length;
  $('stat-resolved').innerHTML = `${pct}<span class="unit">%</span>`;
  $('stat-resolved-bar').style.width = `${pct}%`;
  $('reports-total').textContent = total;
  $('reports-critical').textContent = open.filter(x => x.severity === 'Critical').length;
  $('reports-unassigned').textContent = incidents.filter(x => x.status === 'Open').length;
  const confs = incidents.map(x => x.confidence).filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)));
  $('reports-confidence').textContent = confs.length ? `${(confs.reduce((a, b) => a + Number(b), 0) / confs.length).toFixed(1)}%` : '—';
  $('wo-total').textContent = workOrders.length;
  $('wo-pending').textContent = workOrders.filter(x => x.status === 'New').length;
  $('wo-progress').textContent = workOrders.filter(x => x.status === 'In progress').length;
  $('wo-done').textContent = workOrders.filter(x => x.status === 'Resolved').length;
}

function renderLegend() {
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  incidents.forEach(x => { if (counts[x.severity] !== undefined) counts[x.severity]++; });
  $('legend-critical').textContent = counts.Critical;
  $('legend-high').textContent = counts.High;
  $('legend-medium').textContent = counts.Medium;
  $('legend-low').textContent = counts.Low;
  document.querySelectorAll('[data-count="all"]').forEach(el => { el.textContent = incidents.length; });
}

/* ---------- Rendering: queue, reports, map list ---------- */
function queueItem(item, index) {
  return `<li class="q-item s-${slug(item.severity)}" data-focus="${esc(item.id)}" tabindex="0" role="button" aria-label="${esc(item.type)} at ${esc(shortLocation(item.location))}, ${esc(item.severity)}">
    <span class="q-rank">${String(index + 1).padStart(2, '0')}</span>
    <div class="q-body">
      <div class="q-top">${plate(item.id)}${sampleTag(item)}<span class="q-ago">${esc(reportedLabel(item))}</span></div>
      <strong>${esc(item.type)}</strong>
      <span class="q-loc">${esc(shortLocation(item.location))}</span>
      <div class="q-meta">${sevBadge(item.severity)}${stBadge(item.status)}</div>
    </div>
    <button class="icon-btn" data-detail="${esc(item.id)}" aria-label="Open record ${esc(item.id)}">${icon('chevron')}</button>
  </li>`;
}
function renderQueue() {
  const rows = sortedIncidents().filter(x => x.status !== 'Resolved').slice(0, 6);
  $('priority-table-body').innerHTML = rows.length
    ? rows.map(queueItem).join('')
    : `<li class="empty" style="margin:20px"><strong>Queue is clear</strong><span>No open incidents. New reports will appear here, highest risk first.</span></li>`;
}

function reportRow(item) {
  const order = orderFor(item.id);
  const conf = item.confidence === null || item.confidence === undefined ? '—' : `${Number(item.confidence).toFixed(1)}%`;
  return `<tr data-detail="${esc(item.id)}" tabindex="0">
    <td data-label="Report">${plate(item.id)}${sampleTag(item)}</td>
    <td data-label="Defect"><span class="type-cell">${icon(TYPE_ICON[item.type] || 'other')}${esc(item.type)}</span></td>
    <td class="loc" data-label="Location">${esc(item.location)}</td>
    <td class="ago" data-label="Reported">${esc(reportedLabel(item))}</td>
    <td data-label="Severity">${sevBadge(item.severity)}</td>
    <td class="num" data-label="Model">${conf}</td>
    <td data-label="Status">${stBadge(item.status)}</td>
    <td data-label="Order">${order ? `<span class="plate">${esc(order.id)}</span>` : `<button class="btn btn-sm" data-make-order="${esc(item.id)}">Create order</button>`}</td>
  </tr>`;
}
function renderReports() {
  const q = ($('report-search').value || '').toLowerCase().trim();
  const sev = $('severity-filter').value, st = $('status-filter').value, sort = $('sort-filter').value;
  let rows = incidents.filter(item => {
    const hit = !q || [item.id, item.type, item.location, item.description, item.source].join(' ').toLowerCase().includes(q);
    return hit && (sev === 'all' || slug(item.severity) === sev) && (st === 'all' || slug(item.status) === st);
  });
  if (sort === 'newest') rows.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  else if (sort === 'location') rows.sort((a, b) => a.location.localeCompare(b.location));
  else rows = rows.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.id.localeCompare(a.id, undefined, { numeric: true }));
  $('reports-table-body').innerHTML = rows.length
    ? rows.map(reportRow).join('')
    : `<tr class="empty-row"><td colspan="8"><div class="empty" style="border:0"><strong>No reports match</strong><span>Try a different search or clear the filters.</span></div></td></tr>`;
  $('report-results-count').textContent = `Showing ${rows.length} of ${incidents.length} reports`;
}

function visibleIncidents() {
  return sortedIncidents().filter(x => currentMapFilter === 'all' || slug(x.severity) === currentMapFilter);
}
function renderMapList() {
  const rows = visibleIncidents();
  $('map-count').textContent = `${rows.length} shown`;
  $('map-list').innerHTML = rows.length
    ? rows.map(item => `<li class="q-item s-${slug(item.severity)}" data-focus="${esc(item.id)}" tabindex="0" role="button" id="ml-${esc(item.id)}">
        <span class="q-rank">${icon(TYPE_ICON[item.type] || 'other', 'i-lg')}</span>
        <div class="q-body"><div class="q-top">${plate(item.id)}${sampleTag(item)}<span class="q-ago">${esc(reportedLabel(item))}</span></div><strong>${esc(item.type)}</strong><span class="q-loc">${esc(shortLocation(item.location))}</span><div class="q-meta">${sevBadge(item.severity)}${stBadge(item.status)}</div></div>
        <span></span></li>`).join('')
    : `<li class="empty" style="margin:16px"><strong>Nothing here</strong><span>No incidents match this severity filter.</span></li>`;
}

function showMapDetail(id) {
  const item = incidents.find(x => x.id === id);
  const el = $('map-side-card');
  document.querySelectorAll('#map-list .q-item').forEach(li => li.classList.toggle('is-active', li.dataset.focus === id));
  if (!item) {
    el.innerHTML = `<div class="map-empty"><strong>Select a pin</strong>Choose a marker or a list entry to read its record here.</div>`;
    return;
  }
  const order = orderFor(item.id);
  el.innerHTML = `<div class="detail-line">${plate(item.id)}${stBadge(item.status)}</div>
    <h3>${esc(item.type)}</h3>${sevBadge(item.severity)}
    <p>${esc(item.location)}</p>
    <div class="facts">
      <div><small>Model confidence</small><b>${item.confidence === null || item.confidence === undefined ? 'Field report' : Number(item.confidence).toFixed(1) + '%'}</b></div>
      <div><small>Risk score</small><b>${riskOf(item)}/100</b></div>
      <div><small>Reported</small><b>${esc(reportedLabel(item))}</b></div>
      <div><small>Crew</small><b>${esc(item.team || 'Unassigned')}</b></div>
    </div>
    <button class="btn btn-sm btn-ink" data-detail="${esc(item.id)}">Open full record</button>
    ${order ? '' : `<button class="btn btn-sm" data-make-order="${esc(item.id)}">Create order</button>`}`;
}

/* ---------- Rendering: work orders ---------- */
function teamOptions(selected) {
  return TEAMS.map(t => `<option ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
function orderCard(w) {
  return `<article class="wo-card s-${slug(w.priority)}" draggable="true" data-order="${esc(w.id)}">
    <div class="wo-top">${plate(w.id)}${sevBadge(w.priority)}</div>
    <h4>${esc(w.title)}</h4>
    <button class="wo-link" data-detail="${esc(w.incident)}">${icon('link', 'i-sm')} ${esc(w.incident)} · ${esc(w.location)}</button>
    <div class="wo-due">${icon('clock', 'i-sm')} ${esc(w.due || '—')}</div>
    <div class="wo-foot">
      <select class="control" data-order-team="${esc(w.id)}" aria-label="Crew for ${esc(w.id)}">${teamOptions(w.team)}</select>
      <select class="control" data-order-status="${esc(w.id)}" aria-label="Status of ${esc(w.id)}">${ORDER_STATUSES.map(s => `<option ${s === w.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </div>
  </article>`;
}
function renderOrders() {
  const cols = [['New', 'col-new'], ['Assigned', 'col-assigned'], ['In progress', 'col-progress'], ['Resolved', 'col-done']];
  $('kanban-board').innerHTML = cols.map(([status, cls]) => {
    const items = workOrders.filter(w => w.status === status).sort((a, b) => SEV_ORDER[a.priority] - SEV_ORDER[b.priority]);
    return `<section class="kan-col ${cls}" data-col="${status}" aria-label="${status}">
      <div class="kan-head"><h3>${status}</h3><span class="plate">${items.length}</span></div>
      <div class="kan-cards">${items.map(orderCard).join('') || '<div class="empty-col">Drop a card here</div>'}</div>
    </section>`;
  }).join('');
}

/* ---------- Rendering: pipeline, mix, analytics ---------- */
function renderPipeline() {
  const el = $('pipeline-body');
  const total = workOrders.length;
  if (!total) {
    el.innerHTML = `<div class="empty"><strong>No work orders yet</strong><span>Raise one from any incident to start tracking repairs.</span><button class="btn btn-sm" data-goto="work-orders">Open work orders</button></div>`;
    return;
  }
  const c = { New: 0, Assigned: 0, 'In progress': 0, Resolved: 0 };
  workOrders.forEach(w => { if (c[w.status] !== undefined) c[w.status]++; });
  const w = (n) => (total ? (n / total * 100).toFixed(1) : 0);
  const waiting = c.New;
  const next = workOrders.filter(x => x.status !== 'Resolved').sort((a, b) => SEV_ORDER[a.priority] - SEV_ORDER[b.priority]).slice(0, 3);
  el.innerHTML = `
    <div class="pl-counts">
      <div class="pl-count"><b>${c.New}</b><span>New</span></div>
      <div class="pl-count"><b>${c.Assigned}</b><span>Assigned</span></div>
      <div class="pl-count"><b>${c['In progress']}</b><span>In progress</span></div>
      <div class="pl-count"><b>${c.Resolved}</b><span>Resolved</span></div>
    </div>
    <div class="pl-bar" role="img" aria-label="Work-order stages"><span class="c-new" style="width:${w(c.New)}%"></span><span class="c-assigned" style="width:${w(c.Assigned)}%"></span><span class="c-progress" style="width:${w(c['In progress'])}%"></span><span class="c-done" style="width:${w(c.Resolved)}%"></span></div>
    <p class="pl-note">${waiting ? `<b>${waiting}</b> of ${total} ${waiting === 1 ? 'order is' : 'orders are'} waiting for a crew.` : `Every order has a crew. ${c.Resolved} of ${total} resolved.`}</p>
    <ul class="pl-list">${next.map(o => `<li><span>${plate(o.id)} ${esc(o.title)}</span><span>${esc(o.due || '')}</span></li>`).join('')}</ul>
    <button class="btn btn-block" data-goto="work-orders">Manage work orders</button>`;
}

function countBy(list, key, order) {
  const map = {};
  list.forEach(x => { map[x[key]] = (map[x[key]] || 0) + 1; });
  return order.map(k => [k, map[k] || 0]);
}
function renderMix(targetId) {
  const el = $(targetId);
  if (!incidents.length) { el.innerHTML = `<div class="empty"><strong>No data yet</strong><span>Categories appear as soon as reports are logged.</span></div>`; return; }
  const rows = countBy(incidents, 'type', TYPES).filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]);
  const total = incidents.length;
  el.innerHTML = rows.map(([type, n]) => {
    const pct = Math.round(n / total * 100);
    return `<div class="mix-row">${icon(TYPE_ICON[type] || 'other')}<div><div class="mix-name"><span>${esc(type)}</span><em>${pct}%</em></div><div class="bar"><span style="width:${pct}%"></span></div></div><b>${n}</b></div>`;
  }).join('');
}

function hotspots() {
  const groups = {};
  openIncidents().forEach(x => {
    const area = shortLocation(x.location);
    (groups[area] = groups[area] || { area, n: 0, score: 0, types: new Set() });
    groups[area].n++; groups[area].score += SEV_WEIGHT[x.severity] || 1; groups[area].types.add(x.type);
  });
  return Object.values(groups).sort((a, b) => b.score - a.score || b.n - a.n);
}

function renderAnalytics() {
  const spots = hotspots().slice(0, 6);
  const maxScore = Math.max(1, ...spots.map(s => s.score));
  $('an-hotspots').innerHTML = spots.length ? spots.map((s, i) => `<div class="rank-row"><span class="rank-no">${String(i + 1).padStart(2, '0')}</span><div><strong>${esc(s.area)}<small>${s.n} open · ${[...s.types].map(esc).join(', ')}</small></strong><div class="bar thick"><span style="width:${Math.round(s.score / maxScore * 100)}%"></span></div></div><b>${s.score}</b></div>`).join('')
    : `<div class="empty"><strong>No open incidents</strong><span>Hotspots rank areas by open issues, weighted by severity.</span></div>`;
  renderMix('an-category');

  const sevTotal = Math.max(1, incidents.length);
  $('an-severity').innerHTML = countBy(incidents, 'severity', SEVERITIES).map(([s, n]) => `<div class="hbar s-${slug(s)}"><span>${sevBadge(s)}</span><div class="bar coloured thick"><span style="width:${Math.round(n / sevTotal * 100)}%"></span></div><b>${n}</b></div>`).join('');
  $('an-status').innerHTML = countBy(incidents, 'status', INCIDENT_STATUSES).map(([s, n]) => `<div class="hbar"><span>${stBadge(s)}</span><div class="bar thick"><span style="width:${Math.round(n / sevTotal * 100)}%"></span></div><b>${n}</b></div>`).join('');

  const repeat = spots.find(s => s.n >= 2);
  const waiting = incidents.filter(x => x.status === 'Open').length;
  let title, text;
  if (!incidents.length) { title = 'Nothing to analyse yet'; text = 'Insights appear once reports are logged.'; }
  else if (repeat) { title = `Repeat reports in ${repeat.area}`; text = `${repeat.n} open issues (${[...repeat.types].join(', ').toLowerCase()}) are clustered here. Repeated surface defects on one corridor often share a cause such as drainage or sub-base wear — verify on site before ordering separate patch jobs.`; }
  else if (waiting) { title = `${waiting} ${waiting === 1 ? 'issue is' : 'issues are'} waiting for a crew`; text = 'Raise work orders for the highest-risk open incidents first. The dispatch queue on the overview is already ordered by severity.'; }
  else { title = 'Queue under control'; text = 'Every open incident has a crew. Keep an eye on in-progress repairs and verify closed ones on site.'; }
  $('an-insight').innerHTML = `<div class="insight"><strong>${esc(title)}</strong><p>${esc(text)}</p><button class="link-btn" data-goto="live-map">Review the map</button></div>`;

  const sample = [18, 24, 21, 30, 27, 35, 33, 41, 38, 46, 44, 52];
  const W = 900, H = 200, bw = 44, gap = (W - 40 - bw * sample.length) / (sample.length - 1);
  const max = 60;
  $('an-trend').innerHTML = `<svg class="trend" viewBox="0 0 ${W} ${H + 26}" role="img" aria-label="Illustrative weekly report volume">
    ${[0, 20, 40, 60].map(v => { const y = H - v / max * H + 6; return `<line class="grid" x1="30" x2="${W}" y1="${y}" y2="${y}"/><text x="0" y="${y + 3}">${v}</text>`; }).join('')}
    ${sample.map((v, i) => { const h = v / max * H, x = 40 + i * (bw + gap); return `<rect class="col${i === sample.length - 1 ? ' last' : ''}" x="${x}" y="${H - h + 6}" width="${bw}" height="${h}"/><text x="${x + bw / 2 - 8}" y="${H + 22}">W${i + 1}</text>`; }).join('')}
  </svg>`;
}

/* ---------- Notifications, user, model status ---------- */
function renderNotifications() {
  const rows = sortedIncidents().filter(x => x.status !== 'Resolved' && (x.severity === 'Critical' || x.severity === 'High')).slice(0, 5);
  $('notify-dot').classList.toggle('hidden', !openIncidents().some(x => x.severity === 'Critical'));
  $('notification-list').innerHTML = rows.length
    ? rows.map(x => `<button class="note-row s-${slug(x.severity)}" data-detail="${esc(x.id)}"><span class="sev s-${slug(x.severity)}"><b class="bars"><i></i><i></i><i></i><i></i></b></span><span><strong>${esc(x.type)} · ${esc(x.severity)}</strong><small>${esc(shortLocation(x.location))} · ${esc(x.id)} · ${esc(x.status)}</small></span></button>`).join('')
    : `<div class="empty"><strong>All caught up</strong><span>No critical or high issues are open.</span></div>`;
}

function renderUser() {
  const name = me?.displayName || 'Guest';
  $('user-name').textContent = name;
  $('user-role').textContent = isAdmin ? 'Administrator' : me ? 'Citizen account' : 'Sample workspace';
  $('user-avatar').textContent = (name[0] || '?').toUpperCase();
  $('user-signin').classList.toggle('hidden', isAdmin);
  $('user-signout').classList.toggle('hidden', !me);
  $('session-banner').classList.toggle('hidden', isAdmin);
}

function renderModelStatus(health) {
  const el = $('model-status');
  if (!health) {
    el.className = 'model-line';
    el.innerHTML = '<i class="dot"></i><span>Server offline — photos cannot be stored</span>';
  } else if (health.aiModel === 'yolo-weights-present') {
    el.className = 'model-line ready';
    el.innerHTML = '<i class="dot"></i><span>Detection model installed · suggestions need review</span>';
  } else {
    el.className = 'model-line missing';
    el.innerHTML = '<i class="dot"></i><span>No detection model installed · photos go to manual review</span>';
  }
}

/* ---------- Evidence list ---------- */
function renderEvidence() {
  const el = $('recent-intake-list');
  if (!isAdmin) { el.innerHTML = '<li class="evidence-empty">Sign in as an administrator to see stored evidence.</li>'; return; }
  if (!evidenceItems.length) { el.innerHTML = '<li class="evidence-empty">No photos stored yet.</li>'; return; }
  el.innerHTML = evidenceItems.slice(0, 3).map(x => `<li><span class="cmd-ico" style="display:grid;place-items:center;width:30px;height:30px;border:1.5px solid var(--rule-2)">${icon('image', 'i-sm')}</span><div><strong>${esc(x.filename)}</strong><small>${esc(rel(x.createdAt))}${x.lat !== null && x.lat !== undefined ? ' · GPS' : ''}</small></div><span class="st st-submitted">Pending review</span></li>`).join('');
}
async function loadEvidence() {
  if (!isAdmin) { renderEvidence(); return; }
  try { evidenceItems = (await api('/evidence')).items || []; } catch (e) { evidenceItems = []; }
  renderEvidence();
}

/* ---------- Inbox (community complaints) ---------- */
function mapCategory(c) {
  const ai = c.aiAnalysis?.prediction?.type;
  if (ai && TYPES.includes(ai)) return ai;
  return CATEGORY_TO_TYPE[String(c.category || '').trim().toLowerCase()] || 'Other';
}
function inboxCard(c) {
  const ai = c.aiAnalysis || {};
  const aiLine = ai.status === 'inference_complete'
    ? (ai.prediction ? `Model suggests ${ai.prediction.type} (${ai.prediction.className}, ${(Number(ai.prediction.confidence) * 100).toFixed(0)}%). Unverified.` : 'Model found no defect above its threshold.')
    : ai.status === 'not_run' ? 'No photo supplied.' : ai.status === 'model_not_configured' ? 'No detection model installed.' : 'Model analysis unavailable.';
  const linked = promoted[c.id];
  const thumb = c.image ? `<img src="${esc(c.image)}" alt="Complaint photo" loading="lazy">` : icon('image', 'i-lg');
  return `<article class="ib-card">
    <div class="ib-thumb">${thumb}</div>
    <div class="ib-body">
      <div class="ib-top">${plate(c.id)}${stBadge(c.status)}<span class="ago">${esc(rel(c.createdAt))}</span></div>
      <h3>${esc(String(c.category || '').trim())}</h3>
      <div class="ib-loc">${esc(c.location)}${Number.isFinite(Number(c.lat)) && c.lat !== null ? ` · ${Number(c.lat).toFixed(4)}, ${Number(c.lng).toFixed(4)}` : ''}</div>
      <p class="ib-desc">${esc(c.description)}</p>
      <div class="ib-ai">${esc(aiLine)}</div>
      <div class="ib-foot">
        ${linked ? `<span class="ib-linked">${icon('check', 'i-sm')} Linked to ${esc(linked)}</span><button class="btn btn-sm" data-detail="${esc(linked)}">Open record</button>`
          : `<select class="control" id="promote-sev-${esc(c.id)}" aria-label="Severity for ${esc(c.id)}">${SEVERITIES.map(s => `<option ${s === 'Medium' ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn btn-sm btn-primary" data-promote="${esc(c.id)}">Promote to incident</button>`}
      </div>
    </div>
  </article>`;
}
function renderInboxBadge() {
  const n = complaints.filter(c => c.status === 'Submitted' && !promoted[c.id]).length;
  $('inbox-count').textContent = n;
  $('inbox-count').classList.toggle('hidden', n === 0);
}
function renderInbox() {
  const el = $('inbox-list');
  if (!isAdmin) {
    el.innerHTML = `<div class="inbox-state">${icon('shield', 'i-lg')}<strong>Administrator sign-in required</strong><p>Community complaints contain citizen details and photos, so they are only visible to administrators.</p><button class="btn btn-primary" data-open-signin>Sign in</button></div>`;
    return;
  }
  if (inboxError) { el.innerHTML = `<div class="inbox-state"><strong>Could not load complaints</strong><p>${esc(inboxError)}</p><button class="btn" id="inbox-retry">Try again</button></div>`; return; }
  if (!inboxLoaded) { el.innerHTML = `<div class="inbox-state"><strong>Loading…</strong></div>`; return; }
  const q = ($('inbox-search').value || '').toLowerCase().trim(), f = $('inbox-filter').value;
  const rows = complaints.filter(c => (!f || c.status === f) && (!q || [c.id, c.category, c.location, c.description, c.reporter?.email].join(' ').toLowerCase().includes(q)));
  el.innerHTML = rows.length ? rows.map(inboxCard).join('')
    : `<div class="inbox-state"><strong>${complaints.length ? 'No complaints match' : 'No complaints yet'}</strong><p>${complaints.length ? 'Try a different search or status filter.' : 'Reports submitted through the citizen portal will arrive here.'}</p></div>`;
}
async function loadInbox() {
  if (!isAdmin) { renderInbox(); renderInboxBadge(); return; }
  inboxError = '';
  try { complaints = (await api('/admin/complaints')).items || []; inboxLoaded = true; }
  catch (e) { inboxError = e.message; }
  renderInbox(); renderInboxBadge();
}
async function promoteComplaint(id) {
  const c = complaints.find(x => x.id === id);
  if (!c || promoted[id]) return;
  const sevEl = $(`promote-sev-${id}`);
  const hasCoords = c.lat !== null && c.lat !== undefined && c.lng !== null && c.lng !== undefined;
  const item = makeReport({
    type: mapCategory(c), severity: sevEl ? sevEl.value : 'Medium', location: c.location,
    lat: hasCoords ? c.lat : null, lng: hasCoords ? c.lng : null,
    description: c.description, source: `Citizen complaint ${c.id}`,
    confidence: c.aiAnalysis?.prediction ? Number((Number(c.aiAnalysis.prediction.confidence) * 100).toFixed(1)) : null,
    image: c.image || null, complaintId: c.id
  });
  promoted[id] = item.id;
  commit(`${c.id} promoted to ${item.id}.`);
  if (c.status === 'Submitted') {
    try { await api('/admin/complaints/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: 'Under review' }) }); c.status = 'Under review'; renderInbox(); renderInboxBadge(); } catch (e) { /* the incident is saved; status update is best-effort */ }
  }
}

/* ---------- Maps ---------- */
function markerIcon(item) {
  return L.divIcon({
    className: 'pin-wrap',
    html: `<div class="pin s-${slug(item.severity)} ${item.status === 'Resolved' ? 'is-done' : ''}">${icon(TYPE_ICON[item.type] || 'other')}</div>`,
    iconSize: [30, 38], iconAnchor: [15, 36], popupAnchor: [0, -34]
  });
}
function createMap(containerId, key, wheel) {
  const el = $(containerId);
  if (!el) return null;
  if (!window.L) {
    el.innerHTML = '<div class="empty" style="margin:20px"><strong>Map unavailable</strong><span>The map library could not be loaded. Check your internet connection and reload.</span></div>';
    return null;
  }
  const map = L.map(el, { zoomControl: false, scrollWheelZoom: wheel }).setView(CITY_CENTER, DEFAULT_ZOOM);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  markerLayers[key] = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 250);
  return map;
}
function popupHtml(item) {
  return `<div class="pop"><div class="pop-top">${plate(item.id)}${sevBadge(item.severity)}</div><strong>${esc(item.type)}</strong><span>${esc(shortLocation(item.location))}</span><span>${esc(item.status)} · ${esc(item.team || 'Unassigned')}</span><button class="link-btn" data-detail="${esc(item.id)}">Open record</button></div>`;
}
function renderMapMarkers(key) {
  const map = maps[key], layer = markerLayers[key];
  if (!map || !layer || !window.L) return;
  layer.clearLayers();
  markerIndex[key] = {};
  visibleIncidents().forEach(item => {
    const marker = L.marker([item.lat, item.lng], { icon: markerIcon(item), title: `${item.type} · ${item.id}` });
    marker.bindPopup(popupHtml(item), { autoPanPadding: [40, 40] });
    marker.on('click', () => { if (key === 'full') showMapDetail(item.id); });
    marker.addTo(layer);
    markerIndex[key][item.id] = marker;
  });
}
function fitMap(key) {
  const map = maps[key];
  if (!map) return;
  const pts = visibleIncidents().map(x => [x.lat, x.lng]);
  if (pts.length > 1) map.fitBounds(pts, { padding: [60, 60], maxZoom: 14 });
  else if (pts.length === 1) map.setView(pts[0], 14);
  else map.setView(CITY_CENTER, DEFAULT_ZOOM);
}
function initializeMaps() {
  maps.mini = createMap('map', 'mini', false);
  maps.full = createMap('full-map', 'full', true);
  renderMapMarkers('mini'); renderMapMarkers('full');
  fitMap('mini'); fitMap('full');
}
function setMapFilter(filter) {
  currentMapFilter = filter;
  ['map-filter', 'full-map-filter'].forEach(id => {
    $(id).querySelectorAll('button').forEach(btn => btn.classList.toggle('selected', btn.dataset.filter === filter));
  });
  renderMapMarkers('mini'); renderMapMarkers('full'); renderMapList(); fitMap('mini'); fitMap('full');
  showMapDetail(null);
}
function focusIncident(id) {
  const item = incidents.find(x => x.id === id);
  if (!item) return;
  const key = activeView === 'live-map' ? 'full' : 'mini';
  const map = maps[key], marker = markerIndex[key][id];
  if (key === 'full') showMapDetail(id);
  if (!map || !marker) return;
  document.querySelectorAll('.pin.is-focus').forEach(p => p.classList.remove('is-focus'));
  map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), 15), { duration: .6 });
  marker.openPopup();
  marker.getElement()?.querySelector('.pin')?.classList.add('is-focus');
}

/* ---------- Modals ---------- */
function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  closeDropdowns();
  lastFocus = document.activeElement;
  modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => modal.querySelector('input:not([type=hidden]),select,textarea,button:not([data-close-modal])')?.focus(), 40);
}
function closeModals() {
  document.querySelectorAll('.modal-backdrop.open').forEach(m => { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); });
  document.body.style.overflow = '';
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}
function anyModalOpen() { return !!document.querySelector('.modal-backdrop.open'); }

function openDetail(id) {
  const item = incidents.find(x => x.id === id);
  if (!item) return;
  currentDetailId = id;
  const order = orderFor(id);
  $('detail-title').textContent = item.type;
  $('detail-content').innerHTML = `
    <div class="detail-top">${plate(item.id)}${sevBadge(item.severity)}${stBadge(item.status)}${sampleTag(item)}</div>
    <p class="detail-where"><b>${esc(item.location)}</b><br><span class="kicker">Reported ${esc(reportedLabel(item))} · ${esc(item.source || 'Field report')}${item.approximate ? ' · approximate pin' : ''}</span></p>
    ${item.image ? `<img class="detail-image" src="${esc(item.image)}" alt="Evidence photo for ${esc(item.id)}">` : ''}
    <div class="facts">
      <div><small>Model confidence</small><b>${item.confidence === null || item.confidence === undefined ? 'Manual report' : Number(item.confidence).toFixed(1) + '%' + (item.preview ? ' · suggestion' : '')}</b></div>
      <div><small>Risk score</small><b>${riskOf(item)}/100</b></div>
      <div><small>Crew</small><b>${esc(item.team || 'Unassigned')}</b></div>
      <div><small>Work order</small><b>${order ? esc(order.id) + ' · ' + esc(order.status) : 'None yet'}</b></div>
      <div><small>Coordinates</small><b>${Number(item.lat).toFixed(5)}, ${Number(item.lng).toFixed(5)}</b></div>
      <div><small>Evidence</small><b>${item.evidenceId ? 'Stored on server' : item.image ? 'Citizen photo' : 'None attached'}</b></div>
    </div>
    <div class="detail-desc">${esc(item.description || 'No additional notes were supplied.')}</div>
    <div class="detail-edit">
      <label class="field"><span>Severity</span><select id="detail-severity">${SEVERITIES.map(s => `<option ${s === item.severity ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="field"><span>Status</span><select id="detail-status">${INCIDENT_STATUSES.map(s => `<option ${s === item.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger btn-sm" id="detail-delete" style="margin-right:auto">Delete</button>
      ${order ? `<button class="btn" data-goto="work-orders" data-close-modal>View work order</button>` : `<button class="btn" data-make-order="${esc(item.id)}">Create work order</button>`}
      <button class="btn btn-primary" id="detail-save">Save changes</button>
    </div>`;
  openModal('detail-modal');
}

function openOrderModal(preselect) {
  const free = sortedIncidents().filter(x => !orderFor(x.id));
  if (!free.length) { toast('Every incident already has a work order.', 'link'); return; }
  $('wo-incident').innerHTML = free.map(x => `<option value="${esc(x.id)}" ${x.id === preselect ? 'selected' : ''}>${esc(x.id)} · ${esc(x.type)} · ${esc(shortLocation(x.location))}</option>`).join('');
  $('wo-team').innerHTML = teamOptions('Unassigned');
  const due = new Date(Date.now() + 2 * 86400000);
  $('wo-due').value = due.toISOString().slice(0, 10);
  $('wo-title').dataset.touched = '';
  fillOrderTitle();
  openModal('wo-modal');
}
function fillOrderTitle() {
  const inc = incidents.find(x => x.id === $('wo-incident').value);
  if (inc && !$('wo-title').dataset.touched) $('wo-title').value = `${inc.type} — ${shortLocation(inc.location)}`;
}

/* ---------- Upload & analysis ---------- */
function formatBytes(b) { return b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`; }
function resetUpload() {
  selectedFile = null;
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedPreviewUrl = null;
  $('evidence-input').value = '';
  $('upload-zone').classList.remove('hidden');
  $('upload-preview').classList.add('hidden');
  $('analysis-progress').classList.add('hidden');
  $('analysis-bar').style.width = '0';
  $('analyze-button').disabled = true;
}
function acceptFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast('Please choose a JPG, PNG or WebP photo.', 'close'); return; }
  if (file.size > 8 * 1024 * 1024) { toast('Photos must be 8 MB or smaller.', 'close'); return; }
  resetUpload();
  selectedFile = file;
  selectedPreviewUrl = URL.createObjectURL(file);
  $('upload-zone').classList.add('hidden');
  $('upload-preview').classList.remove('hidden');
  $('preview-name').textContent = file.name;
  $('preview-meta').textContent = `Image · ${formatBytes(file.size)}`;
  $('preview-thumb').innerHTML = `<img src="${selectedPreviewUrl}" alt="Selected photo preview">`;
  $('analyze-button').disabled = false;
}
function getOptionalGPS() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), source: 'device_gps' }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 });
  });
}
function setProgress(label, pct) {
  $('analysis-label').textContent = label;
  $('analysis-percent').textContent = `${pct}%`;
  $('analysis-bar').style.width = `${pct}%`;
}
async function runEvidenceAnalysis() {
  if (!selectedFile || uploadBusy) return;
  uploadBusy = true;
  $('analyze-button').disabled = true;
  $('analysis-progress').classList.remove('hidden');
  try {
    setProgress('Checking location permission…', 15);
    // Prefer the photo's embedded GPS position; use device GPS only when EXIF has no coordinates.
    const exifCoords = await window.StreetSenseGeo?.readExifGPS(selectedFile);
    const coords = exifCoords || await getOptionalGPS();
    let evidence = null;
    if (backend()?.online) {
      setProgress('Saving photo to the server…', 45);
      evidence = await backend().uploadEvidence(selectedFile, coords);
    } else {
      toast('Server not available — the report is saved on this device without the photo.', 'link');
    }
    setProgress('Creating a review-required incident…', 85);
    const prediction = evidence?.analysis?.prediction || null;
    const confidence = prediction ? Number((prediction.confidence * 100).toFixed(1)) : null;
    const severity = prediction ? (confidence >= 85 ? 'High' : confidence >= 60 ? 'Medium' : 'Low') : 'Low';
    const aiNote = prediction
      ? `Model detected ${prediction.className} at ${confidence}% confidence. This is an automated suggestion and requires human verification.`
      : `No model prediction was produced (status: ${evidence?.modelStatus || 'model_not_configured'}). No category or confidence was guessed; human review is required.`;
    const item = makeReport({
      type: prediction?.type || 'Other', severity,
      location: coords ? (coords.source === 'photo_exif' ? 'Photo EXIF location · pending verification' : 'Device GPS location · pending verification') : 'Location not provided · pending verification',
      lat: coords?.lat ?? evidence?.lat ?? null, lng: coords?.lng ?? evidence?.lng ?? null,
      description: `Photo: ${selectedFile.name}. ${evidence ? 'Stored on the server.' : 'Not stored on the server.'} ${aiNote}`,
      source: prediction ? 'Photo analysis · pending human review' : 'Photo upload · manual review', confidence, preview: true, evidenceId: evidence?.id || null
    });
    setProgress('Done', 100);
    uploadBusy = false;
    resetUpload();
    commit(prediction ? `Model suggests ${prediction.className} (${confidence}%). Verify before action.` : 'Photo stored. Manual review required.');
    loadEvidence();
    focusIncident(item.id);
  } catch (e) {
    uploadBusy = false;
    $('analyze-button').disabled = false;
    setProgress('Upload could not be saved', 0);
    toast(e.message || 'Photo upload failed.', 'close');
  }
}

/* ---------- Export ---------- */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
function exportCSV() {
  const rows = [['Report ID', 'Defect type', 'Severity', 'Status', 'Location', 'Latitude', 'Longitude', 'Reported', 'Model confidence %', 'Crew', 'Work order', 'Source', 'Sample record', 'Description']];
  incidents.forEach(x => rows.push([x.id, x.type, x.severity, x.status, x.location, x.lat, x.lng, reportedLabel(x), x.confidence ?? '', x.team || 'Unassigned', orderFor(x.id)?.id || '', x.source || '', isSample(x) ? 'yes' : 'no', x.description || '']));
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `streetsense-register-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('Register exported as CSV.', 'download');
}

/* ---------- Navigation ---------- */
const VIEWS = ['overview', 'live-map', 'reports', 'work-orders', 'analytics', 'inbox'];
function navigate(view, { push = true } = {}) {
  if (!VIEWS.includes(view)) view = 'overview';
  activeView = view;
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === `view-${view}`));
  document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.view === view; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  closeDropdowns();
  if (push) { try { history.replaceState(null, '', `#${view}`); } catch (e) { /* file:// */ } }
  if (view === 'live-map') setTimeout(() => { maps.full?.invalidateSize(); }, 120);
  if (view === 'overview') setTimeout(() => { maps.mini?.invalidateSize(); }, 120);
  if (view === 'inbox') { if (isAdmin && !inboxLoaded) loadInbox(); else renderInbox(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Theme, clock, dropdowns ---------- */
function applyTheme(theme) {
  const t = theme || document.documentElement.dataset.theme || 'light';
  document.documentElement.dataset.theme = t;
  $('theme-toggle').innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  $('theme-toggle').setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* session only */ }
  applyTheme(next);
}
function tickClock() {
  $('local-clock').textContent = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date()).toUpperCase() + ' IST';
}
function closeDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  $('notification-button')?.setAttribute('aria-expanded', 'false');
  $('user-chip')?.setAttribute('aria-expanded', 'false');
}
function toggleDropdown(buttonId, panelId) {
  const panel = $(panelId), btn = $(buttonId), willOpen = !panel.classList.contains('open');
  closeDropdowns();
  if (willOpen) { panel.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
}

/* ---------- Command palette ---------- */
function commandList() {
  const cmds = [
    ['Pages', 'overview', 'Go to overview', 'Daily brief and dispatch queue', 'overview'],
    ['Pages', 'live-map', 'Open live map', 'Explore geolocated incidents', 'map'],
    ['Pages', 'reports', 'Open incident reports', 'Search and filter the register', 'reports'],
    ['Pages', 'work-orders', 'Open work orders', 'Manage the repair board', 'orders'],
    ['Pages', 'analytics', 'Open analytics', 'Hotspots, mix and progress', 'analytics'],
    ['Pages', 'inbox', 'Open citizen inbox', 'Complaints from the public portal', 'inbox'],
    ['Actions', 'new-report', 'Log a field report', 'Add a defect to the register', 'plus'],
    ['Actions', 'new-order', 'Create a work order', 'Assign a crew to an incident', 'orders'],
    ['Actions', 'upload', 'Add a street photo', 'Store evidence and run the model', 'upload'],
    ['Actions', 'export', 'Export register as CSV', 'Download all incidents', 'download'],
    ['Actions', 'theme', 'Switch colour theme', 'Light and dark appearance', 'sun'],
    ['Actions', 'how', 'How StreetSense works', 'The review workflow', 'other'],
    ['Links', 'admin', 'Open admin console', 'Complaints and accounts', 'shield'],
    ['Links', 'portal', 'Open citizen portal', 'The public reporting site', 'arrow'],
    ['Workspace', 'clear-sample', 'Remove sample records', 'Keep only real incidents and orders', 'close'],
    ['Workspace', 'reset', 'Restore sample workspace', 'Replace everything with the demo data', 'refresh']
  ];
  if (!isAdmin) cmds.splice(12, 0, ['Actions', 'signin', 'Sign in as administrator', 'Load the server register', 'key']);
  else cmds.splice(12, 0, ['Actions', 'signout', 'Sign out', 'End the administrator session', 'logout']);
  return cmds.map(([group, id, title, detail, ico]) => ({ group, id, title, detail, ico }));
}
function renderPalette() {
  const q = ($('command-search').value || '').trim().toLowerCase();
  let items = commandList().filter(c => !q || `${c.title} ${c.detail} ${c.id}`.toLowerCase().includes(q));
  if (q) {
    incidents.filter(x => [x.id, x.type, x.location].join(' ').toLowerCase().includes(q)).slice(0, 5)
      .forEach(x => items.push({ group: 'Incidents', id: `incident:${x.id}`, title: `${x.id} · ${x.type}`, detail: `${shortLocation(x.location)} · ${x.severity} · ${x.status}`, ico: TYPE_ICON[x.type] || 'other' }));
  }
  paletteItems = items; paletteIndex = 0;
  if (!items.length) { $('command-results').innerHTML = `<div class="cmd-empty">Nothing matches “${esc(q)}”. Try “map”, “export” or an incident ID.</div>`; return; }
  let last = '';
  $('command-results').innerHTML = items.map((c, i) => {
    const head = c.group !== last ? `<div class="cmd-group">${c.group}</div>` : '';
    last = c.group;
    return `${head}<button type="button" class="cmd ${i === 0 ? 'selected' : ''}" role="option" data-cmd="${i}"><span class="cmd-ico">${icon(c.ico)}</span><span class="txt"><strong>${esc(c.title)}</strong><small>${esc(c.detail)}</small></span></button>`;
  }).join('');
}
function openPalette() {
  closeDropdowns();
  lastFocus = document.activeElement;
  const el = $('command-backdrop');
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
  $('command-search').value = '';
  renderPalette();
  setTimeout(() => $('command-search').focus(), 30);
}
function closePalette() {
  const el = $('command-backdrop');
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
}
function movePalette(dir) {
  if (!paletteItems.length) return;
  paletteIndex = (paletteIndex + dir + paletteItems.length) % paletteItems.length;
  document.querySelectorAll('.cmd').forEach((b, i) => { b.classList.toggle('selected', i === paletteIndex); if (i === paletteIndex) b.scrollIntoView({ block: 'nearest' }); });
}
function runPalette(index) {
  const c = paletteItems[index];
  if (!c) return;
  closePalette();
  if (c.id.startsWith('incident:')) { navigate('reports'); openDetail(c.id.slice(9)); return; }
  runCommand(c.id);
}
function runCommand(id) {
  switch (id) {
    case 'overview': case 'live-map': case 'reports': case 'work-orders': case 'analytics': case 'inbox': navigate(id); break;
    case 'new-report': openModal('report-modal'); break;
    case 'new-order': openOrderModal(); break;
    case 'upload': navigate('overview'); setTimeout(() => $('evidence-input').click(), 200); break;
    case 'export': exportCSV(); break;
    case 'theme': toggleTheme(); break;
    case 'how': openModal('methodology-modal'); break;
    case 'admin': location.href = '/admin.html'; break;
    case 'portal': window.open('/', '_blank', 'noopener'); break;
    case 'signin': openModal('signin-modal'); break;
    case 'signout': signOut(); break;
    case 'clear-sample':
      if (window.confirm('Remove all sample incidents and work orders? Real records you added are kept.')) {
        for (let i = incidents.length - 1; i >= 0; i--) if (isSample(incidents[i])) incidents.splice(i, 1);
        for (let i = workOrders.length - 1; i >= 0; i--) if (workOrders[i].sample === true || SEED_ORDER_IDS.has(workOrders[i].id) || !incidents.some(x => x.id === workOrders[i].incident)) workOrders.splice(i, 1);
        commit('Sample records removed.');
      }
      break;
    case 'reset':
      if (window.confirm('Replace the whole workspace with the original sample data? Your changes will be lost.')) {
        incidents.splice(0, incidents.length, ...seedIncidents());
        workOrders.splice(0, workOrders.length, ...seedOrders());
        promoted = {};
        commit('Sample workspace restored.');
      }
      break;
  }
}

/* ---------- Auth ---------- */
async function signOut() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  location.reload();
}
async function submitSignin(e) {
  e.preventDefault();
  $('signin-error').textContent = '';
  try {
    const d = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('signin-email').value, password: $('signin-password').value }) });
    if (d.user.role !== 'admin') { await api('/auth/logout', { method: 'POST' }); throw new Error('This account is not an administrator.'); }
    location.reload();
  } catch (err) { $('signin-error').textContent = err.message; }
}

/* ---------- Events ---------- */
function setupEvents() {
  $('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) navigate(b.dataset.view); });

  document.addEventListener('click', e => {
    const t = e.target;
    const make = t.closest('[data-make-order]');
    if (make) { e.preventDefault(); closeModals(); openOrderModal(make.dataset.makeOrder); return; }
    const promote = t.closest('[data-promote]');
    if (promote) { promoteComplaint(promote.dataset.promote); return; }
    if (t.closest('[data-open-signin]')) { openModal('signin-modal'); return; }
    const detail = t.closest('[data-detail]');
    if (detail) { e.preventDefault(); closeDropdowns(); closePalette(); closeModals(); openDetail(detail.dataset.detail); return; }
    const focus = t.closest('[data-focus]');
    if (focus) { focusIncident(focus.dataset.focus); return; }
    const go = t.closest('[data-goto]');
    if (go) { closeModals(); navigate(go.dataset.goto); return; }
    if (t.closest('[data-close-modal]')) { closeModals(); return; }
    if (t.classList?.contains('modal-backdrop')) { t.id === 'command-backdrop' ? closePalette() : closeModals(); return; }
    if (!t.closest('.menu-wrap')) closeDropdowns();
  });

  document.addEventListener('keydown', e => {
    const typing = e.target.matches?.('input,textarea,select,[contenteditable="true"]');
    const paletteOpen = $('command-backdrop').classList.contains('open');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen ? closePalette() : openPalette(); return; }
    if (paletteOpen) {
      if (e.key === 'Escape') { closePalette(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); return; }
    }
    if (e.key === 'Escape') { closeDropdowns(); if (anyModalOpen()) closeModals(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-focus],tr[data-detail]')) { e.preventDefault(); e.target.click(); return; }
    if (typing || anyModalOpen() || e.ctrlKey || e.metaKey) return;
    if (e.key === '/') { e.preventDefault(); openPalette(); }
    else if (e.altKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); navigate(VIEWS[Number(e.key) - 1]); }
    else if (e.key.toLowerCase() === 'n' && !e.altKey) { e.preventDefault(); openModal('report-modal'); }
    if (e.key === 'Tab') return;
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const modal = document.querySelector('.modal-backdrop.open');
    if (!modal) return;
    const f = [...modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  $('command-search').addEventListener('input', renderPalette);
  $('command-results').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b) runPalette(Number(b.dataset.cmd)); });
  $('top-search-button').addEventListener('click', openPalette);
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('notification-button').addEventListener('click', e => { e.stopPropagation(); toggleDropdown('notification-button', 'notification-panel'); });
  $('user-chip').addEventListener('click', e => { e.stopPropagation(); toggleDropdown('user-chip', 'user-menu'); });
  $('notification-view-all').addEventListener('click', () => navigate('reports'));
  $('open-methodology').addEventListener('click', () => openModal('methodology-modal'));
  $('foot-how').addEventListener('click', () => openModal('methodology-modal'));
  $('user-signin').addEventListener('click', () => openModal('signin-modal'));
  $('banner-signin').addEventListener('click', () => openModal('signin-modal'));
  $('user-signout').addEventListener('click', signOut);
  $('signin-form').addEventListener('submit', submitSignin);

  ['new-report-button', 'map-report-button', 'reports-new-button'].forEach(id => $(id).addEventListener('click', () => openModal('report-modal')));
  ['export-overview', 'export-reports', 'export-analytics'].forEach(id => $(id).addEventListener('click', exportCSV));
  $('create-work-order').addEventListener('click', () => openOrderModal());

  $('map-filter').addEventListener('click', e => { const b = e.target.closest('button[data-filter]'); if (b) setMapFilter(b.dataset.filter); });
  $('full-map-filter').addEventListener('click', e => { const b = e.target.closest('button[data-filter]'); if (b) setMapFilter(b.dataset.filter); });
  $('map-locate').addEventListener('click', () => fitMap('mini'));
  $('full-map-reset').addEventListener('click', () => fitMap('full'));

  ['report-search', 'severity-filter', 'status-filter', 'sort-filter'].forEach(id => $(id).addEventListener(id === 'report-search' ? 'input' : 'change', renderReports));
  $('inbox-search').addEventListener('input', renderInbox);
  $('inbox-filter').addEventListener('change', renderInbox);
  $('inbox-refresh').addEventListener('click', () => { inboxLoaded = false; loadInbox(); loadEvidence(); });
  $('inbox-list').addEventListener('click', e => { if (e.target.id === 'inbox-retry') loadInbox(); });

  $('report-form').addEventListener('submit', e => {
    e.preventDefault();
    const item = makeReport({ type: $('form-type').value, severity: $('form-severity').value, location: $('form-location').value, lat: $('form-lat').value, lng: $('form-lng').value, description: $('form-description').value.trim(), source: 'Manual field report' });
    e.target.reset(); closeModals(); commit(`${item.id} added to the register.`);
    if (activeView === 'live-map') focusIncident(item.id);
  });
  $('form-locate').addEventListener('click', async () => {
    const btn = $('form-locate'); btn.disabled = true;
    const c = await getOptionalGPS(); btn.disabled = false;
    if (c) { $('form-lat').value = c.lat.toFixed(6); $('form-lng').value = c.lng.toFixed(6); toast(`Location added (±${c.accuracy} m).`, 'locate'); }
    else toast('Location was not available.', 'close');
  });

  $('wo-incident').addEventListener('change', fillOrderTitle);
  $('wo-title').addEventListener('input', () => { $('wo-title').dataset.touched = '1'; });
  $('wo-form').addEventListener('submit', e => {
    e.preventDefault();
    const due = $('wo-due').value ? new Date($('wo-due').value + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
    const order = addWorkOrder({ incidentId: $('wo-incident').value, title: $('wo-title').value.trim(), team: $('wo-team').value, due });
    closeModals();
    if (order) commit(`${order.id} created.`);
  });

  $('detail-content').addEventListener('click', e => {
    if (e.target.closest('#detail-save')) saveIncidentEdits();
    if (e.target.closest('#detail-delete')) deleteIncident(currentDetailId);
  });

  /* Kanban: menus + drag and drop */
  const board = $('kanban-board');
  board.addEventListener('change', e => {
    const s = e.target.closest('[data-order-status]'); if (s) { setOrderStatus(s.dataset.orderStatus, s.value); return; }
    const t = e.target.closest('[data-order-team]'); if (t) setOrderTeam(t.dataset.orderTeam, t.value);
  });
  board.addEventListener('dragstart', e => {
    const card = e.target.closest('.wo-card'); if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.order); e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });
  board.addEventListener('dragend', () => { board.querySelectorAll('.dragging').forEach(c => c.classList.remove('dragging')); board.querySelectorAll('.drop').forEach(c => c.classList.remove('drop')); });
  board.addEventListener('dragover', e => { const col = e.target.closest('.kan-col'); if (!col) return; e.preventDefault(); board.querySelectorAll('.drop').forEach(c => { if (c !== col) c.classList.remove('drop'); }); col.classList.add('drop'); });
  board.addEventListener('drop', e => {
    const col = e.target.closest('.kan-col'); if (!col) return;
    e.preventDefault(); col.classList.remove('drop');
    const id = e.dataTransfer.getData('text/plain'); if (id) setOrderStatus(id, col.dataset.col);
  });

  /* Upload */
  const zone = $('upload-zone');
  zone.addEventListener('click', () => $('evidence-input').click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('evidence-input').click(); } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); acceptFile(e.dataTransfer.files[0]); });
  $('evidence-input').addEventListener('change', e => acceptFile(e.target.files[0]));
  $('remove-file').addEventListener('click', resetUpload);
  $('analyze-button').addEventListener('click', runEvidenceAnalysis);

  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== activeView) navigate(v, { push: false }); });
  window.addEventListener('beforeunload', () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 3, savedAt: new Date().toISOString(), incidents, workOrders })); } catch (e) { /* ignore */ } });
}

/* ---------- Boot ---------- */
async function init() {
  restoreLocal();
  setupEvents();
  applyTheme();
  tickClock(); setInterval(tickClock, 30000);
  showMapDetail(null);

  const be = backend();
  let health = null;
  if (be) {
    const connected = await be.connect();
    if (connected) { try { health = await api('/health'); } catch (e) { /* ignore */ } }
  }
  try { const d = await api('/auth/me'); me = d.user; } catch (e) { me = null; }
  isAdmin = !!(me && me.role === 'admin');

  const serverUp = !!be?.online;
  if (!serverUp || !isAdmin) showAccessBanner(serverUp);
  if (be?.online && !isAdmin) {
    be.online = false;
    $('system-status').innerHTML = '<span class="pulse-dot"></span> Server up · sample workspace';
    setPill('Saved on this device', 'Sign in as an administrator to sync with the server register.');
  }
  if (be?.online && isAdmin) {
    try {
      const saved = await be.loadSnapshot();
      snapshotVersion = saved.version || null;
      if (Array.isArray(saved.incidents)) {
        incidents.splice(0, incidents.length, ...saved.incidents);
        if (Array.isArray(saved.workOrders)) workOrders.splice(0, workOrders.length, ...saved.workOrders);
      }
      setPill('Synced to server', 'Incident and work-order data is saved in the SQLite register.');
    } catch (e) { console.warn('Server register could not be loaded:', e); }
  }

  renderUser();
  renderModelStatus(health);
  initializeMaps();
  updateAll();
  renderEvidence();
  if (isAdmin) { loadEvidence(); loadInbox(); } else { renderInbox(); }

  const start = location.hash.slice(1);
  if (VIEWS.includes(start) && start !== 'overview') navigate(start, { push: false });
  setTimeout(() => { maps.mini?.invalidateSize(); maps.full?.invalidateSize(); }, 600);
}

function showAccessBanner(serverUp) {
  if (document.getElementById('access-banner')) return;
  const b = document.createElement('div'); b.id = 'access-banner'; b.setAttribute('role', 'alert');
  b.style.cssText = 'position:sticky;top:0;z-index:9999;background:#ef7d1a;color:#1a1000;padding:10px 16px;font:600 14px system-ui,sans-serif;text-align:center';
  b.innerHTML = serverUp ? 'You are not signed in as an administrator, so this is only a sample workspace and nothing is saved to the server. <a href="/admin.html" style="color:inherit;text-decoration:underline">Sign in here</a>, then reload this page.' : 'Cannot reach the StreetSense server. Start it with start.bat, then reload this page.';
  document.body.prepend(b);
}
document.addEventListener('DOMContentLoaded', init);
