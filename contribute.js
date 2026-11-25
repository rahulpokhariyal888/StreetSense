"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let timer = null;
async function me() { const r = await fetch('/api/auth/me', { credentials: 'same-origin' }); if (!r.ok) return null; const j = await r.json(); return j.user || null; }
async function auth(path, body) {
  const r = await fetch('/api/auth/' + path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Sign-in failed'); return j;
}
async function show() {
  const u = await me(); $('login').classList.toggle('hide', Boolean(u)); $('up').classList.toggle('hide', !u); $('mine').classList.toggle('hide', !u);
  if (u) { $('who').textContent = 'Signed in as ' + u.displayName; jobs(); }
}
async function jobs() {
  const r = await fetch('/api/contribute/jobs', { credentials: 'same-origin' }); if (!r.ok) return; const j = (await r.json()).jobs;
  $('jobs').innerHTML = j.length ? j.map(x => `<div class="note"><b>${esc(x.filename)}</b> <span class="pill ${x.status === 'done' ? 'p-ok' : x.status === 'failed' ? 'p-imm' : ''}">${esc(x.status)}</span><div class="mute">${x.status === 'processing' ? 'Scanning… this can take a few minutes.' : x.status === 'done' ? `${x.defects} defects found · ${x.newReports} new reports · ${x.workOrders} work orders created` : esc(x.message || '')}</div></div>`).join('') : '<p class="mute">Nothing uploaded yet.</p>';
  clearTimeout(timer); if (j.some(x => x.status === 'processing')) timer = setTimeout(jobs, 3000);
}
$('li').onclick = async () => { try { await auth('login', { email: $('em').value, password: $('pw').value }); show(); } catch (e) { $('lmsg').textContent = e.message; } };
$('reg').onclick = async () => { try { await auth('register', { email: $('em').value, password: $('pw').value, name: $('nm').value }); show(); } catch (e) { $('lmsg').textContent = e.message; } };
$('geo').onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { $('slat').value = p.coords.latitude.toFixed(5); $('slng').value = p.coords.longitude.toFixed(5); }, () => { $('msg').textContent = 'Location permission was denied.'; }) : ($('msg').textContent = 'Location is not available in this browser.');
$('go').onclick = () => {
  const f = $('vf').files[0]; if (!f) { $('msg').textContent = 'Choose a video first.'; return; }
  const q = new URLSearchParams({ filename: f.name, startLat: $('slat').value.trim(), startLng: $('slng').value.trim(), endLat: $('elat').value.trim(), endLng: $('elng').value.trim() });
  const x = new XMLHttpRequest(); x.open('POST', '/api/contribute/video?' + q); x.withCredentials = true; $('bar').style.display = '';
  x.upload.onprogress = e => { if (e.lengthComputable) { $('bar').firstChild.style.width = (e.loaded / e.total * 100) + '%'; $('msg').textContent = 'Uploading ' + Math.round(e.loaded / e.total * 100) + '%'; } };
  x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { } $('bar').style.display = 'none'; $('msg').textContent = x.status === 202 ? 'Thanks! Scanning started.' : (j.error || 'Upload failed.'); $('vf').value = ''; jobs(); };
  x.onerror = () => { $('bar').style.display = 'none'; $('msg').textContent = 'Upload failed.'; }; x.send(f);
};
show();
