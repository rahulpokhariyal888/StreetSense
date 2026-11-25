'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const map = L.map('map').setView([28.62, 77.2], 11), layer = L.layerGroup().addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
async function search(auto) {
  const q = $('q').value.trim(), r = await (await fetch('/api/public/repairs?q=' + encodeURIComponent(q), { cache: 'no-store' })).json(), items = r.items || [], reports = r.reports || [], all = [...items, ...reports];
  layer.clearLayers(); const pts = [];
  items.forEach(x => { L.circleMarker([x.lat, x.lng], { radius: 8, color: '#ffffff', weight: 2, fillColor: '#0b2545', fillOpacity: 1 }).bindPopup(`<b>${esc(x.type)}</b><br>${esc(x.location)}<br>${esc(x.scheduled)}`).addTo(layer); pts.push([x.lat, x.lng]); });
  reports.filter(x => x.lat !== null).forEach(x => { L.circleMarker([x.lat, x.lng], { radius: 9, color: '#12d6b5', weight: 3, fillColor: '#fff', fillOpacity: .9 }).bindPopup(`<b>${esc(x.type)}</b> (citizen report)<br>${esc(x.location)}<br>${esc(x.scheduled)}`).addTo(layer); pts.push([x.lat, x.lng]); });
  if (pts.length && !auto) map.fitBounds(L.latLngBounds(pts).pad(.2), { maxZoom: 14 });
  $('msg').textContent = (q.length < 2 ? `Showing ${items.length} scheduled repairs and ${reports.length} citizen reports across the city. Search to narrow them down.` : all.length ? `Good news: ${all.length} matching ${all.length === 1 ? 'issue is' : 'issues are'} already in the system. You do not need to report ${all.length === 1 ? 'it' : 'them'} again.` : 'Nothing matching is in the system yet. You can report it from the home page.') + '  Updated ' + new Date().toLocaleTimeString() + '.';
  $('list').innerHTML = all.map(x => `<div class="card"><b>${esc(x.type)}</b> <span class="pill">${esc(x.status)}</span>${x.citizen ? ' <span class="pill p-watch">Citizen report</span>' : ''}<br>${esc(x.location)}<div class="mute">Scheduled: <b>${esc(x.scheduled)}</b> · ${esc(x.crew)}${x.sample ? ' · sample record' : ''}${x.citizen && x.lat === null ? ' · no map pin (no GPS given)' : ''}</div></div>`).join('');
}
async function impact() {
  const i = await (await fetch('/api/public/impact')).json();
  $('impact').innerHTML = [['Potholes filled', i.potholesFilled], ['Repairs completed', i.repairsCompleted], ['Active crews', i.activeCrews], ['Est. claim exposure avoided', '₹' + i.estimatedSavedInr.toLocaleString('en-IN')]].map(k => `<div class="card kpi"><span class="mute">${k[0]}</span><b>${k[1]}</b></div>`).join('');
  $('basis').textContent = i.basis;
}
$('go').addEventListener('click', () => search(false));
$('refresh').addEventListener('click', () => { search(true); impact(); });
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') search(false); });
search(false); impact(); setInterval(() => { impact(); search(true); }, 15000);
