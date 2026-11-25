const FRIENDLY_CLASS={D00:'Longitudinal crack',D01:'Longitudinal crack (joint)',D10:'Lateral crack',D11:'Lateral crack (joint)',D20:'Alligator crack',D40:'Pothole',D43:'Faded crosswalk',D44:'Faded white line',D50:'Manhole / utility cover',D0w0:'Unrecognised class (D0w0)',waterlogging:'Waterlogging',road_edge_breakage:'Road edge breakage',failed_repair_patch:'Failed repair patch',asphalt_ravelling:'Asphalt ravelling',surface_bleeding:'Surface bleeding'};const friendlyClass=c=>FRIENDLY_CLASS[String(c)]||String(c||'Unknown');
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let result = null, dets = [], pin = null;
const map = L.map('map').setView([28.62, 77.2], 11); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
function setPin(lat, lng) { $('lat').value = Number(lat).toFixed(5); $('lng').value = Number(lng).toFixed(5); if (pin) pin.setLatLng([lat, lng]); else pin = L.circleMarker([lat, lng], { radius: 9, color: '#0b2545', weight: 3, fillColor: '#12d6b5', fillOpacity: 1 }).addTo(map); }
map.on('click', e => setPin(e.latlng.lat, e.latlng.lng));
$('gps').addEventListener('click', () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { setPin(p.coords.latitude, p.coords.longitude); map.setView([p.coords.latitude, p.coords.longitude], 15); }, () => { $('st').textContent = 'Location permission was denied. Click the map instead.'; }) : ($('st').textContent = 'GPS is not available. Click the map instead.'));
$('f').addEventListener('change', async () => {
  const f = $('f').files[0]; result = null; dets = []; $('dets').innerHTML = ''; $('cv').width = 0;
  if (!f) return;
  $('img').src = URL.createObjectURL(f);
  // Keep an already selected map pin/manual coordinate; otherwise use embedded photo GPS.
  if (!$('lat').value.trim() && !$('lng').value.trim()) {
    const exif = await window.StreetSenseGeo?.readExifGPS(f);
    if (exif) { setPin(exif.lat, exif.lng); map.setView([exif.lat, exif.lng], 15); $('st').textContent = 'GPS location read from photo metadata. You can adjust the pin on the map.'; }
    else $('st').textContent = 'No GPS location found in photo metadata. Use GPS or click the map to set a location.';
  }
});
function draw() {
  const img = $('img'), c = $('cv'); if (!img.clientWidth) return; c.width = img.clientWidth; c.height = img.clientHeight; const sx = c.width / img.naturalWidth, sy = c.height / img.naturalHeight, g = c.getContext('2d'); g.lineWidth = 3; g.font = '12px sans-serif';
  dets.forEach(d => { const [x1, y1, x2, y2] = d.bbox, t = `${friendlyClass(d.className)} ${Math.round(d.confidence * 100)}%`, w = g.measureText(t).width + 8, ty = Math.max(0, y1 * sy - 16); g.strokeStyle = '#12d6b5'; g.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy); g.fillStyle = '#12d6b5'; g.fillRect(x1 * sx, ty, w, 16); g.fillStyle = '#04211d'; g.fillText(t, x1 * sx + 4, ty + 12); });
}
$('img').addEventListener('load', draw); window.addEventListener('resize', draw);
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401 || r.status === 403) { $('auth').classList.remove('hide'); throw new Error('Sign in as an administrator first.'); }
  const j = await r.json().catch(() => ({})); if (r.status === 404 && /route not found/i.test(j.error || '')) throw new Error('The running server is older than these pages. Copy server.js and insights.js from the latest zip into your StreetSense folder, then fully stop and restart start.bat.'); if (!r.ok) throw new Error(j.error || 'Request failed'); return j;
}
$('go').addEventListener('click', () => {
  const f = $('f').files[0]; if (!f) { $('st').textContent = 'Choose an image first.'; return; }
  const rd = new FileReader(); $('st').textContent = 'Analysing…';
  rd.onload = async () => {
    try {
      const lat = parseFloat($('lat').value), lng = parseFloat($('lng').value), body = { filename: f.name, mimeType: f.type, base64: String(rd.result).split(',')[1] }; if (Number.isFinite(lat) && Number.isFinite(lng)) { body.lat = lat; body.lng = lng; }
      result = await post('/api/evidence', body); const a = result.analysis || {}; dets = a.detections || []; draw();
      if (a.status !== 'inference_complete') { $('st').textContent = a.message || 'The detection model is not available. You can still pick the type yourself.'; $('dets').innerHTML = ''; return; }
      if (a.scene && a.scene.isRoad === false) { dets = []; draw(); $('dets').innerHTML = ''; $('st').textContent = a.scene.reason + ' No defects were reported. Choose a road photo.'; return; }
      $('st').textContent = dets.length ? `${dets.length} defect${dets.length > 1 ? 's' : ''} found. Check the boxes, then place the pin.` : 'No defect found in this image.';
      $('dets').innerHTML = dets.length ? `<table><tr><th>Class</th><th>Confidence</th></tr>${Object.values(dets.reduce((m, d) => { const k = friendlyClass(d.className), e = m[k] || (m[k] = { className: k, best: 0, n: 0 }); e.n++; e.best = Math.max(e.best, d.confidence); return m; }, {})).map(g => `<tr><td>${esc(g.className)}${g.n > 1 ? ' · ' + g.n + ' areas' : ''}</td><td>${Math.round(g.best * 100)}%</td></tr>`).join('')}</table><p class="mute">Model output is a suggestion. A person reviews it before anything is repaired.</p>` : '';
      if (a.prediction) { $('type').value = a.prediction.type; const c = a.prediction.confidence; $('sev').value = c >= .85 ? 'High' : c >= .6 ? 'Medium' : 'Low'; }
    } catch (e) { $('st').textContent = e.message; }
  }; rd.readAsDataURL(f);
});
async function submit(confirm) {
  try {
    const lat = parseFloat($('lat').value), lng = parseFloat($('lng').value), top = dets[0], img = $('img');
    const r = await post('/api/insights/review/submit', { evidenceId: result && result.id, type: $('type').value, severity: $('sev').value, confidence: top ? top.confidence * 100 : null, lat, lng, location: $('loc').value, boxes: dets.map(d => ({ bbox: d.bbox, label: friendlyClass(d.className), confidence: d.confidence })), imgW: img.naturalWidth, imgH: img.naturalHeight, confirm });
    $('msg').textContent = r.queued ? `Sent to the review queue as ${r.id}.` : `Confirmed as ${r.incident}. Work order ${r.workOrder} created.`;
  } catch (e) { $('msg').textContent = e.message; }
}
$('queue').addEventListener('click', () => submit(false)); $('confirm').addEventListener('click', () => submit(true));

document.getElementById('a-go').addEventListener('click', async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('a-em').value, password: document.getElementById('a-pw').value }) });
  const j = await r.json().catch(() => ({})), m = document.getElementById('a-msg');
  if (r.ok && j.user && j.user.role === 'admin') location.reload(); else m.textContent = r.ok ? 'That account is not an administrator.' : (j.error || 'Sign-in failed.');
});
