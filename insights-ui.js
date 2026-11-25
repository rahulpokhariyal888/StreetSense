'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UI_BUILD = '20', STALE = 'The running server is older than these pages. Copy server.js and insights.js from the latest zip into your StreetSense folder, then fully stop and restart start.bat.';
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
async function api(p, o = {}) {
  const r = await fetch('/api/insights/' + p, { credentials: 'same-origin', ...o, headers: { 'content-type': 'application/json' } });
  if (r.status === 401 || r.status === 403) { $('auth').classList.remove('hide'); throw new Error('auth'); }
  const j = await r.json().catch(() => ({})); if (r.status === 404 && /route not found/i.test(j.error || '')) throw new Error(STALE); if (!r.ok) throw new Error(j.error || 'Request failed'); return j;
}
const colour = v => v >= 75 ? '#d3341d' : v >= 55 ? '#f4731a' : v >= 35 ? '#f4b400' : '#1e8e4e';
const pill = f => f.length ? `<span class="pill ${f.some(x => x.level === 'immediate') ? 'p-imm' : 'p-watch'}">${f.some(x => x.level === 'immediate') ? 'Immediate' : 'Watch'}</span>` : '';
let data = null, map, layer, rmap, rlayer, version = null, active = 'heat';

function setTab(v) {
  active = v; document.querySelectorAll('.view').forEach(e => e.classList.toggle('on', e.id === 'v-' + v));
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === v));
  render(); setTimeout(() => { map && map.invalidateSize(); rmap && rmap.invalidateSize(); }, 50);
}
$('tabs').addEventListener('click', e => { if (e.target.dataset.v) setTab(e.target.dataset.v); });

function predictedOf(x) { const z = data.zones.find(z => z.id === x.zone) || { traffic: 60 }; return Math.min(100, Math.round(x.priority * data.weather.factor * (0.8 + z.traffic / 200))); }

function renderHeat() {
  const open = data.incidents.filter(x => x.status !== 'Resolved'), types = [...new Set(data.incidents.map(x => x.type))];
  const ft = $('f-type'); if (ft.options.length === 1) types.forEach(t => ft.add(new Option(t, t)));
  $('kpis').innerHTML = [['Open defects', open.length], ['Critical-grade (PCI<25)', open.filter(x => x.pci < 25).length], ['Liability flags', data.flagged.length], ['Detected from footage', data.incidents.filter(x => /^(Footage|Fleet)/.test(String(x.source))).length], ['Citizen reports to review', (data.citizenReports || []).length], ['AI detections awaiting review', data.queueCount || 0]].map(k => `<div class="card kpi"><span class="mute">${k[0]}</span><b>${k[1]}</b></div>`).join('');
  if (!map) { map = L.map('map').setView([28.62, 77.2], 11); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map); map.createPane('heat').style.zIndex = 450; map.getPane('heat').classList.add('leaflet-heat-pane'); layer = L.layerGroup().addTo(map); }
  layer.clearLayers(); const metric = $('f-metric').value, tf = $('f-type').value;
  data.incidents.filter(x => x.status !== 'Resolved' && (!tf || x.type === tf)).forEach(x => {
    const v = metric === 'predicted' ? predictedOf(x) : x.priority;
    L.circle([x.lat, x.lng], { pane: 'heat', radius: 450 + v * 8, stroke: false, fillColor: colour(v), fillOpacity: .55 }).addTo(layer);
    L.circleMarker([x.lat, x.lng], { radius: 5, color: '#16181a', weight: 1, fillColor: colour(v), fillOpacity: 1 }).bindPopup(`<b>${esc(x.id)}</b> ${esc(x.type)}<br>${esc(x.location)}<br>Condition ${x.pci}/100 (${esc(x.grade)})<br>Priority ${x.priority} → predicted ${predictedOf(x)}`).addTo(layer);
  });
  (data.citizenReports || []).filter(c => c.lat !== null).forEach(c => L.circleMarker([c.lat, c.lng], { radius: 7, color: '#12d6b5', weight: 3, fillColor: '#fff', fillOpacity: .9 }).bindPopup(`<b>Citizen report ${esc(c.id)}</b><br>${esc(c.category)}<br>${esc(c.location)}<br>${esc(c.status)}`).addTo(layer));
  $('flags').innerHTML = data.flagged.length ? data.flagged.map(x => `<div class="note">${pill(x.flags)} <b>${esc(x.id)}</b> ${esc(x.location)}<br>${x.flags.map(f => esc(f.reason)).join('<br>')}</div>`).join('') : '<p class="mute">No open flags.</p>';
  $('table').innerHTML = `<table><tr><th>ID</th><th>Type</th><th>Location</th><th>Zone</th><th>Condition</th><th>Priority</th><th>Speed</th><th>Source</th><th>Flag</th><th></th></tr>${[...data.incidents].sort((a, b) => b.priority - a.priority).slice(0, 40).map(x => `<tr><td>${esc(x.id)}</td><td>${esc(x.type)}</td><td>${esc(x.location)}</td><td>${esc(x.zoneName.split(' (')[0])}</td><td>${x.pci} · ${esc(x.grade)}</td><td><div class="bar-h"><i style="width:${x.priority}%;background:${colour(x.priority)}"></i></div></td><td>${x.speedLimit}</td><td>${esc(x.source)}</td><td>${pill(x.flags)}</td><td><button class="btn del" data-del="incident" data-id="${esc(x.id)}">Delete</button></td></tr>`).join('')}</table>`;
}
async function renderPredict() {
  const p = await api('predict'), w = p.weather;
  $('wx').innerHTML = `<div class="grid g4"><div class="kpi"><span class="mute">Rain, past 14 d</span><b>${w.rainPast14} mm</b></div><div class="kpi"><span class="mute">Rain, next 7 d</span><b>${w.rainNext7} mm</b></div><div class="kpi"><span class="mute">Avg day–night swing</span><b>${w.avgSwingC}°C</b></div><div class="kpi"><span class="mute">Stress factor</span><b>×${w.factor}</b></div></div><p class="mute">Weather: ${esc(w.source)}. Freeze-thaw days: ${w.freezeThawDays}.</p>`;
  $('method').textContent = p.method;
  $('pz').innerHTML = `<table><tr><th>Zone</th><th>Traffic</th><th>Now</th><th>Predicted</th></tr>${p.zones.map(z => `<tr><td>${esc(z.name)}</td><td>${z.traffic}</td><td>${z.avgNow}</td><td><b style="color:${colour(z.avgPredicted)}">${z.avgPredicted}</b></td></tr>`).join('')}</table>`;
  $('pi').innerHTML = `<table><tr><th>Next to fail</th><th>Now</th><th>Pred.</th><th>Δ</th></tr>${p.items.map(x => `<tr><td>${esc(x.id)} ${esc(x.type)}<br><span class="mute">${esc(x.location)}</span></td><td>${x.priority}</td><td>${x.predicted}</td><td>+${x.velocity}</td></tr>`).join('')}</table>`;
}
async function renderRoutes() {
  const r = await api('routes'); if (!rmap) { rmap = L.map('rmap').setView([28.62, 77.2], 11); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(rmap); rlayer = L.layerGroup().addTo(rmap); }
  rlayer.clearLayers(); const cols = ['#d3341d', '#1a6fd4', '#1e8e4e', '#8e24aa', '#f4731a', '#00838f'];
  r.crews.forEach((c, i) => { const pts = c.stops.map(s => [s.lat, s.lng]); L.polyline(pts, { color: cols[i % 6], weight: 3, dashArray: '6 6' }).addTo(rlayer); c.stops.forEach(s => L.marker(pts[s.seq - 1], { icon: L.divIcon({ className: '', html: `<div style="background:${cols[i % 6]};color:#fff;width:22px;height:22px;border-radius:50%;text-align:center;font:600 12px/22px sans-serif">${s.seq}</div>` }) }).bindPopup(`${esc(c.name)} · stop ${s.seq}<br>${esc(s.id)} ${esc(s.type)}<br>${esc(s.location)}<br>${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`).addTo(rlayer)); });
  $('crews').innerHTML = r.crews.length ? r.crews.map((c, i) => `<div class="card crew" style="border-left-color:${cols[i % 6]}"><h2>${esc(c.name)}</h2><div class="mute">${c.stops.length} stops · ${c.distanceKm} km · ~${Math.round(c.workMinutes / 60 * 10) / 10} h on site</div><div class="mute"><b>Materials:</b> ${c.materials.map(esc).join('; ')}</div><ol style="padding-left:18px;margin:6px 0 0">${c.stops.map(s => `<li>${esc(s.type)} · ${esc(s.location)}<br><span class="mute">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)} · ${esc(s.id)}</span></li>`).join('')}</ol></div>`).join('') : '<div class="card"><p>Nothing waiting: every open defect already has a work order.</p></div>';
}
async function renderEquity(b) {
  const e = await api('equity' + (b ? '?budget=' + b : '')), c = e.correlation;
  $('corr').innerHTML = `<p>Correlation of spend with 311 call volume: <b>${c.spendVsCalls}</b>. Correlation of spend with measured need: <b>${c.spendVsNeed}</b>. ${c.spendVsCalls > c.spendVsNeed + .3 ? '<b style="color:var(--red)">Spending tracks who calls, not who needs repairs (squeaky-wheel bias).</b>' : 'Spending is not tracking call volume more than need.'}</p>`;
  $('eq').innerHTML = `<table><tr><th>Zone</th><th>Pop (k)</th><th>Income idx</th><th>311 calls</th><th>Open</th><th>Need share</th><th>Spend share</th><th>Equity ratio</th>${b ? '<th>Suggested ₹ lakh</th>' : ''}</tr>${e.zones.map(z => `<tr><td>${esc(z.name)}</td><td>${z.population}</td><td>${z.incomeIndex}</td><td>${z.calls311}</td><td>${z.open}</td><td>${(z.needShare * 100).toFixed(0)}%</td><td>${(z.spendShare * 100).toFixed(0)}%</td><td><span class="pill ${z.underserved ? 'p-imm' : 'p-ok'}">${z.equityRatio ?? '–'}${z.underserved ? ' underserved' : ''}</span></td>${b ? `<td>${z.suggestedLakh}</td>` : ''}</tr>`).join('')}</table><p class="mute">Equity ratio = share of spend ÷ share of need. Below 0.75 is flagged.</p>`;
  const r = e.roi; $('roi').innerHTML = `<div class="grid g4"><div class="kpi"><span class="mute">Cost of completed repairs</span><b>${inr(r.repairedCostInr)}</b></div><div class="kpi"><span class="mute">Claim exposure avoided</span><b>${inr(r.repairedAvoidedInr)}</b></div><div class="kpi"><span class="mute">Backlog repair cost</span><b>${inr(r.backlogCostInr)}</b></div><div class="kpi"><span class="mute">Exposure if backlog stays open</span><b>${inr(r.backlogAvoidedInr)}</b></div></div><p class="mute">Assumptions (edit in insights.js): average claim ${inr(e.assumptions.claimCostInr)}, ${(e.assumptions.claimProbabilityAtPriority100 * 100)}% claim chance at priority 100, scaled by priority. Unit costs per type are placeholders.</p>`;
}
async function renderVerify() {
  const v = await api('verifications'), sel = $('v-wo'), keep = sel.value;
  sel.innerHTML = v.orders.map(o => `<option value="${esc(o.id)}">${esc(o.id)} · ${esc(o.title)} (${esc(o.status)})</option>`).join(''); if (keep) sel.value = keep;
  const by = {}; v.items.forEach(i => (by[i.workOrderId] ||= []).push(i));
  $('v-list').innerHTML = Object.keys(by).map(id => `<div class="card" style="margin-top:10px"><b>${esc(id)}</b><div class="photos">${by[id].map(i => `<figure style="margin:0"><img alt="${esc(i.kind)} photo" src="/api/insights/verification-image/${esc(i.file)}"><figcaption class="mute">${esc(i.kind)} · ${new Date(i.createdAt).toLocaleString()}${i.note ? '<br>' + esc(i.note) : ''}<br><button class="btn del" data-del="verification" data-id="${esc(i.id)}">Delete photo</button></figcaption></figure>`).join('')}</div></div>`).join('') || '<p class="mute">No repair photos yet.</p>';
}

let jobTimer = null;
async function renderFootage() {
  const [im, jb, mt] = await Promise.all([api('impact'), api('video/jobs'), api('metrics')]), o = im.operations, d = im.detection, s = im.safety, b = d.ageBuckets;
  const h1 = v => v === null ? '–' : (v < 48 ? v + ' h' : Math.round(v / 24 * 10) / 10 + ' d'), g = mt.severity.grades;
  $('metrics').innerHTML = `<div class="card"><span class="mute">Defect detection</span><div class="kpi"><b>${mt.detection.aiSharePct}%</b></div><p class="mute">${mt.detection.aiFound} found by AI · ${mt.detection.humanReported} reported by people${mt.detection.avgConfidence !== null ? ' · avg confidence ' + mt.detection.avgConfidence + '%' : ''}</p><p class="mute">${esc(mt.detection.note)}</p></div>
  <div class="card"><span class="mute">Time-to-repair</span><div class="kpi"><b>${h1(mt.ttr.flagToDoneHours)}</b></div><p class="mute">Flagged → order: <b>${h1(mt.ttr.flagToOrderHours)}</b> · order → done: <b>${h1(mt.ttr.orderToDoneHours)}</b></p><p class="mute">${mt.ttr.ordersTimed} orders timed, ${mt.ttr.completedTimed} completed.</p></div>
  <div class="card"><span class="mute">Cost per km inspected</span><div class="kpi"><b>${inr(mt.cost.automatedPerKm)}</b></div><p class="mute">vs ${inr(mt.cost.manualPerKm)} manual: <b>${mt.cost.savingPct}% lower</b> (placeholder rates). ${mt.cost.kmScanned} km scanned so far.</p></div>
  <div class="card"><span class="mute">Severity score (avg open priority)</span><div class="kpi"><b>${mt.severity.avgOpenPriority ?? '–'}</b></div><p class="mute">${mt.severity.openCritical} open at priority 75+ · ${Object.entries(g).map(e => esc(e[0]) + ' ' + e[1]).join(' · ')}</p><p class="mute">${esc(mt.severity.method)}</p></div>`;
  $('pains').innerHTML = `<div class="card"><h2>1 · Inefficient operations</h2><div class="kpi"><span class="mute">Footage scanned</span><b>${o.surveyKm} km</b></div><p class="mute">${o.videosProcessed} videos · ${o.footageMinutes} min · ${o.autoWorkOrders} work orders created automatically</p><p>Manual inspection of this distance ≈ <b>${inr(o.manualCostInr)}</b>; automated ≈ <b>${inr(o.automatedCostInr)}</b>.</p><p class="mute">Assumes ₹${im.assumptions.manualInspectionInrPerKm}/km manual vs ₹${im.assumptions.automatedInrPerKm}/km automated: placeholders, edit in insights.js.</p></div>
  <div class="card"><h2>2 · Delayed detection</h2><div class="kpi"><span class="mute">Open past repair deadline</span><b>${d.overdue}</b></div><p class="mute">Open defects by age</p><p>&lt;1 day <b>${b.under1d}</b> · 1–7 d <b>${b.d1to7}</b> · 7–30 d <b>${b.d7to30}</b> · <span style="color:var(--red)">30 d+ <b>${b.over30d}</b></span></p><p class="mute">${d.detectedFromFootage} defects found from footage. Deadlines: ${Object.entries(im.assumptions.slaLabel).map(e => e[0] + ' ' + e[1].toLowerCase()).join(', ')}.</p></div>
  <div class="card"><h2>3 · Safety &amp; property risk</h2><div class="kpi"><span class="mute">Immediate-risk hazards open</span><b>${s.immediateFlags}</b></div><p class="mute">${s.watchFlags} more on watch</p><p>Claim exposure if the backlog stays open ≈ <b>${inr(s.backlogExposureInr)}</b></p></div>`;
  const J = jb.jobs; if (!jb.modelReady) $('vmsg').textContent = 'YOLO weights not found: footage scanning is unavailable.';
  $('jobs').innerHTML = J.length ? J.map(j => `<div class="note"><b>${esc(j.filename)}</b> <span class="pill ${j.status === 'done' ? 'p-ok' : j.status === 'failed' ? 'p-imm' : ''}">${esc(j.status)}</span>${j.status === 'processing' ? '<div class="mute">Scanning frames… this can take a few minutes.</div>' : ''}${j.message ? `<div class="mute">${esc(j.message)}</div>` : ''}<div><button class="btn del" data-del="video-job" data-id="${esc(j.id)}">Delete scan</button></div>${j.result ? `<div class="mute">${j.result.framesAnalysed} frames · ${j.result.defectsFound} defects (${j.result.created} new, ${j.result.merged} already known) · ${j.result.queued} sent to the review queue${j.result.autoApproved ? ', ' + j.result.autoApproved + ' approved automatically' : ''}. ${esc(j.result.locationNote)}</div><div class="photos">${j.result.items.filter(i => i.frame).map(i => `<figure style="margin:0"><img alt="${esc(i.type)} flagged frame" src="/api/insights/video/frame/${esc(i.frame)}"><figcaption class="mute">${esc(i.type)} · ${esc(i.severity)} · ${i.confidence}% · ${esc(i.note)}</figcaption></figure>`).join('')}</div>` : ''}</div>`).join('') : '<p class="mute">No footage scanned yet.</p>';
  clearTimeout(jobTimer); if (J.some(j => j.status === 'processing') && active === 'footage') jobTimer = setTimeout(renderFootage, 3000);
}
$('geo').onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { $('slat').value = p.coords.latitude.toFixed(5); $('slng').value = p.coords.longitude.toFixed(5); }, () => { $('vmsg').textContent = 'Location permission was denied.'; }) : ($('vmsg').textContent = 'Location is not available in this browser.');
$('vgo').onclick = () => {
  const f = $('vf').files[0]; if (!f) { $('vmsg').textContent = 'Choose a video first.'; return; }
  const q = new URLSearchParams({ filename: f.name, startLat: $('slat').value.trim(), startLng: $('slng').value.trim(), endLat: $('elat').value.trim(), endLng: $('elng').value.trim(), every: $('every').value, autoOrders: '0' });
  const x = new XMLHttpRequest(); x.open('POST', '/api/insights/video/upload?' + q); x.withCredentials = true; $('vbar').style.display = '';
  x.upload.onprogress = e => { if (e.lengthComputable) { $('vbar').firstChild.style.width = (e.loaded / e.total * 100) + '%'; $('vmsg').textContent = `Uploading ${Math.round(e.loaded / e.total * 100)}%`; } };
  x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { } $('vbar').style.display = 'none'; $('vmsg').textContent = x.status === 202 ? 'Uploaded. Scanning started.' : (j.error || 'Upload failed.'); $('vf').value = ''; renderFootage(); };
  x.onerror = () => { $('vbar').style.display = 'none'; $('vmsg').textContent = 'Upload failed.'; }; x.send(f);
};

async function renderCrew() {
  const c = await api('crew'), teams = [...new Set(c.orders.map(o => o.team))].sort(), sel = $('crew-sel'), keep = sel.value;
  sel.innerHTML = teams.map(t => `<option>${esc(t)}</option>`).join(''); if (teams.includes(keep)) sel.value = keep;
  const list = c.orders.filter(o => o.team === sel.value).sort((a, b) => (a.stop || 99) - (b.stop || 99));
  const wo = await api('work-orders');
  $('wo-all').innerHTML = wo.items.length ? `<table><tr><th>Order</th><th>Job</th><th>Status</th><th>Crew</th><th>Due</th><th>Location</th><th></th></tr>${wo.items.map(o => `<tr><td>${esc(o.id)}</td><td>${esc(o.title)}</td><td>${esc(o.status)}</td><td>${esc(o.team)}</td><td>${esc(o.due)}</td><td>${esc(o.location)}</td><td><button class="btn del" data-del="work-order" data-id="${esc(o.id)}">Delete</button></td></tr>`).join('')}</table>` : '<p class="mute">No work orders.</p>';
  $('crew-list').innerHTML = list.length ? list.map(o => `<div class="note"><b>${o.stop ? 'Stop ' + o.stop + ' · ' : ''}${esc(o.title)}</b> <span class="pill">${esc(o.status)}</span><br>${esc(o.location)}<div class="mute">${Number.isFinite(o.lat) ? o.lat.toFixed(5) + ', ' + o.lng.toFixed(5) + ' · ' : ''}Due: ${esc(o.due)} · ${esc(o.id)}<br>Materials: ${esc(o.materials)}</div>${Number.isFinite(o.lat) ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}" target="_blank" rel="noopener">Navigate</a>` : ''}</div>`).join('') : '<p class="mute">No assigned work orders. Create them from "Work orders & routes".</p>';
}
$('crew-sel').onchange = renderCrew;

const TYPE_LIST = ['Pothole', 'Road crack', 'Damaged sign', 'Broken streetlight', 'Blocked drain', 'Other'], SEV_LIST = ['Critical', 'High', 'Medium', 'Low'];
function drawBoxes(img) {
  const c = img.nextElementSibling; if (!c || c.tagName !== 'CANVAS') return; let b = []; try { b = JSON.parse(img.dataset.boxes || '[]'); } catch { }
  if (!b.length || !img.clientWidth) return; const W = Number(img.dataset.w) || img.naturalWidth, H = Number(img.dataset.h) || img.naturalHeight;
  c.width = img.clientWidth; c.height = img.clientHeight; const sx = c.width / W, sy = c.height / H, g = c.getContext('2d'); g.lineWidth = 3; g.font = '12px sans-serif';
  b.forEach(o => { const [x1, y1, x2, y2] = o.bbox; g.strokeStyle = '#12d6b5'; g.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy); const cf = o.confidence == null ? '' : ' ' + Math.round(o.confidence <= 1 ? o.confidence * 100 : o.confidence) + '%', t = (o.label || '') + cf, w = g.measureText(t).width + 8, ty = Math.max(0, y1 * sy - 16); g.fillStyle = '#12d6b5'; g.fillRect(x1 * sx, ty, w, 16); g.fillStyle = '#04211d'; g.fillText(t, x1 * sx + 4, ty + 12); });
}
async function renderReview() {
  const r = await api('review'), unc = r.items.filter(x => x.uncertain).length;
  api('settings').then(s => { $('rq-mode').textContent = s.mode === 'auto' ? `Auto approval is ON: detections at ${s.minConfidence}% confidence or more are approved automatically. Change it in Admin console, Settings.` : 'Manual approval: every detection waits here for a person.'; }).catch(() => { });
  $('rq-sum').textContent = `${r.items.length} waiting · ${unc} uncertain (confidence below ${r.uncertainBelow}% or unknown), shown first.`;
  $('rq').innerHTML = r.items.length ? r.items.map(x => `<div class="card rq" data-id="${esc(x.id)}">${x.frame ? `<div class="ovl"><img alt="Flagged image for ${esc(x.type)}" src="/api/insights/video/frame/${esc(x.frame)}" data-boxes="${esc(JSON.stringify(x.boxes || []))}" data-w="${x.imgW || ''}" data-h="${x.imgH || ''}"><canvas></canvas></div>` : '<div class="mute">No image (sample)</div>'}
   <div><b>${esc(x.id)}</b> ${x.uncertain ? '<span class="pill p-watch">Uncertain</span>' : '<span class="pill p-ok">Confident</span>'} <span class="mute">${x.confidence === null ? 'confidence unknown' : x.confidence + '% confidence'} · seen ${x.sightings || 1}× · ${esc(x.source)}</span><br>${esc(x.location)}
   <div class="row"><label>Type <select data-f="type">${TYPE_LIST.map(t => `<option ${t === x.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Severity <select data-f="severity">${SEV_LIST.map(t => `<option ${t === x.severity ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
   <div class="row"><button class="btn" data-act="confirm">Confirm and create work order</button><button class="btn alt" data-act="reject">Delete: false alarm</button></div></div></div>`).join('') : '<div class="card" style="margin-top:12px"><p>Queue is empty. New detections from footage and image scans will appear here.</p></div>';
  document.querySelectorAll('#rq img[data-boxes]').forEach(i => { const go = () => drawBoxes(i); i.complete ? go() : i.addEventListener('load', go); });
}
$('rq').addEventListener('click', async e => {
  const act = e.target.dataset.act; if (!act) return; const card = e.target.closest('.rq'), body = { id: card.dataset.id, decision: act, type: card.querySelector('[data-f=type]').value, severity: card.querySelector('[data-f=severity]').value };
  e.target.disabled = true; try { await api('review/decide', { method: 'POST', body: JSON.stringify(body) }); $('rq-msg').textContent = act === 'confirm' ? 'Confirmed. Work order created.' : 'Rejected.'; } catch (er) { $('rq-msg').textContent = er.message; } poll(true);
});
$('rq-bulk').addEventListener('click', async () => { try { const r = await api('review/bulk', { method: 'POST', body: JSON.stringify({ minConfidence: Number($('rq-min').value) }) }); $('rq-msg').textContent = `${r.confirmed} detections at ${r.minConfidence}%+ confirmed.`; } catch (er) { $('rq-msg').textContent = er.message; } poll(true); });
function render() { if (!data) return; const fn = { heat: renderHeat, predict: renderPredict, routes: renderRoutes, equity: () => renderEquity(), verify: renderVerify, footage: renderFootage, crew: renderCrew, review: renderReview }[active]; Promise.resolve().then(fn).catch(() => { }); }
async function poll(force) {
  try {
    const d = await api('overview'); const key = d.version + ':' + d.incidents.length; data = d;
    $('rq-count').textContent = d.queueCount || 0;
    $('live').textContent = '● Live · updated ' + new Date().toLocaleTimeString();
    if (force || key !== version) { version = key; render(); }
  } catch (e) { $('live').textContent = e.message === 'auth' ? 'Not signed in' : 'Offline'; }
}
['f-type', 'f-metric'].forEach(id => $(id).addEventListener('change', () => { if (active === 'heat') renderHeat(); }));
$('load-sample').onclick = async () => { const r = await api('sample-data', { method: 'POST' }); $('load-sample').textContent = r.added ? `Loaded ${r.added} sample incidents` : 'Sample data already loaded'; poll(true); };
$('commit').onclick = async () => { try { const r = await api('routes/commit', { method: 'POST' }); $('commit-msg').textContent = `${r.made} work orders created and assigned.`; poll(true); } catch (e) { $('commit-msg').textContent = e.message; } };
$('bgo').onclick = () => renderEquity(Number($('budget').value));
$('v-go').onclick = () => {
  const f = $('v-file').files[0]; if (!f) { $('v-msg').textContent = 'Choose a photo first.'; return; }
  const rd = new FileReader(); rd.onload = async () => { try { const r = await api('verify', { method: 'POST', body: JSON.stringify({ workOrderId: $('v-wo').value, kind: $('v-kind').value, mimeType: f.type, base64: String(rd.result).split(',')[1], note: $('v-note').value }) }); $('v-msg').textContent = r.resolved ? 'Both photos logged. Work order and incident marked Resolved.' : 'Photo logged.'; $('v-file').value = ''; renderVerify(); poll(true); } catch (e) { $('v-msg').textContent = e.message; } };
  rd.readAsDataURL(f);
};
poll(true); setInterval(() => poll(false), 8000);

document.getElementById('a-go').addEventListener('click', async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('a-em').value, password: document.getElementById('a-pw').value }) });
  const j = await r.json().catch(() => ({})), m = document.getElementById('a-msg');
  if (r.ok && j.user && j.user.role === 'admin') location.reload(); else m.textContent = r.ok ? 'That account is not an administrator.' : (j.error || 'Sign-in failed.');
});

const DEL_MSG = {
  incident: id => `Delete incident ${id}, its work orders and its repair photos? This cannot be undone.`,
  'work-order': id => `Delete work order ${id} and its repair photos? The incident goes back to Open.`,
  verification: () => 'Delete this repair photo? If it closed the job, the job is re-opened.',
  'video-job': () => 'Delete this scan, its video and its flagged images? Incidents already created from it stay.'
};
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-del]'); if (!b) return; const kind = b.dataset.del, id = b.dataset.id;
  if (!DEL_MSG[kind] || !window.confirm(DEL_MSG[kind](id))) return;
  b.disabled = true;
  try { await api(kind + '/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (er) { window.alert(er.message); }
  poll(true);
});

(async function checkBuild() {
  try {
    const h = await (await fetch('/api/health', { cache: 'no-store' })).json();
    if (h.build !== UI_BUILD) {
      const b = document.createElement('div'); b.setAttribute('role', 'alert'); b.style.cssText = 'background:#ef7d1a;color:#1a1000;padding:10px 16px;font:600 14px system-ui,sans-serif;text-align:center';
      b.textContent = `Version mismatch: pages are build ${UI_BUILD} but the running server is ${h.build ? 'build ' + h.build : 'an older build'}. ` + STALE; document.body.prepend(b);
    }
  } catch (e) { /* server not reachable: the live indicator already says so */ }
})();
