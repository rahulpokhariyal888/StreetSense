'use strict';
const crypto = require('node:crypto');
// StreetSense insights module: severity (PCI-style), liability flags, weather-aware prediction,
// route planning, footage scanning, human review queue, before/after verification, equity/ROI, public APIs.
// All zone demographics, 311 counts, spend and cost figures below are ILLUSTRATIVE SAMPLE DATA.
// Replace ZONES and ASSUMPTIONS with MCD / census / finance data for real use.

const ZONES = [
  { id: 'central',  name: 'Central (Connaught Place)', lat: 28.6315, lng: 77.2167, pop: 280, income: 82, calls311: 310, spend: 42, traffic: 95 },
  { id: 'south',    name: 'South (Saket)',             lat: 28.5245, lng: 77.2066, pop: 540, income: 78, calls311: 260, spend: 36, traffic: 70 },
  { id: 'southeast',name: 'South-East (Lajpat Nagar)', lat: 28.5677, lng: 77.2433, pop: 610, income: 66, calls311: 190, spend: 24, traffic: 82 },
  { id: 'west',     name: 'West (Karol Bagh)',         lat: 28.6514, lng: 77.1907, pop: 520, income: 58, calls311: 150, spend: 18, traffic: 85 },
  { id: 'north',    name: 'North (Civil Lines)',       lat: 28.6820, lng: 77.2250, pop: 430, income: 70, calls311: 120, spend: 15, traffic: 60 },
  { id: 'shahdara', name: 'East (Shahdara)',           lat: 28.6700, lng: 77.2900, pop: 880, income: 34, calls311: 70,  spend: 8,  traffic: 78 },
  { id: 'dwarka',   name: 'South-West (Dwarka)',       lat: 28.5921, lng: 77.0460, pop: 720, income: 62, calls311: 85,  spend: 10, traffic: 55 },
  { id: 'rohini',   name: 'North-West (Rohini)',       lat: 28.7380, lng: 77.1130, pop: 690, income: 55, calls311: 80,  spend: 9,  traffic: 58 }
];
const ASSUMPTIONS = {
  repairCostInr: { 'Pothole': 4500, 'Road crack': 1800, 'Damaged sign': 6500, 'Broken streetlight': 3200, 'Blocked drain': 2800, 'Other': 2500 },
  minutesPerStop: { 'Pothole': 35, 'Road crack': 25, 'Damaged sign': 40, 'Broken streetlight': 45, 'Blocked drain': 50, 'Other': 30 },
  materials: { 'Pothole': 'Cold-mix asphalt 40 kg, tack coat, cones', 'Road crack': 'Crack sealant 3 L, cleaning brush', 'Damaged sign': 'Sign plate + clamp set, pole straightening kit', 'Broken streetlight': 'Lamp/driver unit, fuse kit, insulated tools', 'Blocked drain': 'Rodding set, grate key, disposal bags', 'Other': 'General repair kit' },
  claimCostInr: 150000, manualInspectionInrPerKm: 2000, automatedInrPerKm: 200, avgSurveySpeedKmh: 30, slaHours: { Critical: 24, High: 72, Medium: 168, Low: 720 }, slaLabel: { Critical: 'Within 24 h', High: 'Within 72 h', Medium: 'Within 7 days', Low: 'Within 30 days' }, claimProbabilityAtPriority100: 0.04, stopsPerCrewPerDay: 5
};
const BASE = { 'Pothole': 60, 'Road crack': 35, 'Damaged sign': 55, 'Broken streetlight': 40, 'Blocked drain': 45, 'Other': 30 };
const EXTENT = { Critical: [12, 60], High: [8, 40], Medium: [4, 25], Low: [2, 10] };
const TYPES = Object.keys(BASE);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const km = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const nearestZone = p => ZONES.reduce((best, z) => (km(p, z) < km(p, best) ? z : best), ZONES[0]);
const hoursOpen = s => { const m = /(\d+)\s*(min|hr|hour|day)/i.exec(String(s || '')); if (!m) return 0; const n = Number(m[1]); return /min/i.test(m[2]) ? n / 60 : /day/i.test(m[2]) ? n * 24 : n; };
const grade = pci => pci >= 85 ? 'Good' : pci >= 70 ? 'Satisfactory' : pci >= 55 ? 'Fair' : pci >= 40 ? 'Poor' : pci >= 25 ? 'Very poor' : 'Failed';
const speedOf = x => Number(x.speedLimit) || (/(ring road|marg|expressway|outer|nh\s?\d|flyover|bridge)/i.test(x.location) ? 60 : /(market|enclave|colony|lane|block|sector|gali|chowk)/i.test(x.location) ? 30 : 45);

function score(x) {
  const [d0, w0] = EXTENT[x.severity] || EXTENT.Medium, depth = Number(x.depthCm) || d0, width = Number(x.widthCm) || w0, speed = speedOf(x);
  const deduct = clamp(Math.round((BASE[x.type] || 30) * clamp(0.5 + depth / 15 + width / 120, 0.5, 2) * (0.8 + speed / 100) * 0.7), 0, 100);
  const pci = 100 - deduct, zone = nearestZone(x), hrs = x.createdAt ? Math.max(0, (Date.now() - Date.parse(x.createdAt)) / 36e5) : hoursOpen(x.reported), open = x.status !== 'Resolved';
  const flags = [];
  if (open) {
    if (x.type === 'Damaged sign' && speed >= 40) flags.push({ level: 'immediate', reason: `Damaged or missing sign on a ~${speed} km/h road` });
    if (x.type === 'Pothole' && (depth >= 8 || x.severity === 'Critical') && speed >= 40) flags.push({ level: 'immediate', reason: `Deep pothole (~${depth} cm) on a ~${speed} km/h road` });
    if (x.type === 'Broken streetlight' && speed >= 45) flags.push({ level: 'watch', reason: 'Unlit stretch on a fast road' });
    if (hrs > 72 && deduct >= 50) flags.push({ level: 'watch', reason: 'Known high-priority hazard open more than 72 h (notice exposure)' });
  }
  return { id: x.id, type: x.type, severity: x.severity, location: x.location, lat: Number(x.lat), lng: Number(x.lng), status: x.status, source: x.source || '', sample: Boolean(x.sample), speedLimit: speed, depthCm: depth, widthCm: width, pci, grade: grade(pci), priority: deduct, zone: zone.id, zoneName: zone.name, flags, hoursOpen: Math.round(hrs), slaHours: ASSUMPTIONS.slaHours[x.severity] || 168, overdue: open && hrs > (ASSUMPTIONS.slaHours[x.severity] || 168), frame: x.frame || null, sightings: x.sightings || 1 };
}

module.exports = function ({ db, json, bodyJson, audit, readRows, EVIDENCE_DIR, randomUUID, fs, path, spawn, PYTHON, MODEL_PATH, ROOT, classifyYolo, sessionUser }) {
  const VIDEO_DIR = path.join(path.dirname(EVIDENCE_DIR), 'video'), FRAME_DIR = path.join(VIDEO_DIR, 'frames'); fs.mkdirSync(FRAME_DIR, { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS video_jobs (id TEXT PRIMARY KEY, filename TEXT, status TEXT NOT NULL, message TEXT, params TEXT, result TEXT, created_at TEXT NOT NULL, finished_at TEXT);
  CREATE TABLE IF NOT EXISTS detection_queue (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS detection_reviews (id TEXT PRIMARY KEY, type TEXT, confidence REAL, outcome TEXT NOT NULL, source TEXT, decided_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS verifications (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, kind TEXT NOT NULL, stored_name TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL);`);
  const scored = () => readRows('incidents').map(score);
  let wx = null;

  async function weather() {
    if (wx && Date.now() - wx.at < 30 * 60e3) return wx.data;
    let data;
    try {
      const u = 'https://api.open-meteo.com/v1/forecast?latitude=28.61&longitude=77.21&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&past_days=14&forecast_days=7&timezone=Asia%2FKolkata';
      const j = await (await fetch(u, { signal: AbortSignal.timeout(6000) })).json(), d = j.daily, n = d.time.length;
      const idx = i => i < 14, sum = (a, f) => a.reduce((s, v, i) => s + (f(i) ? v || 0 : 0), 0);
      const swings = d.temperature_2m_max.map((v, i) => v - d.temperature_2m_min[i]);
      data = { source: 'Open-Meteo (live)', rainPast14: Math.round(sum(d.precipitation_sum, idx)), rainNext7: Math.round(sum(d.precipitation_sum, i => !idx(i))), avgSwingC: Math.round(swings.reduce((a, b) => a + b, 0) / n * 10) / 10, freezeThawDays: d.temperature_2m_min.filter((v, i) => v <= 2 && d.temperature_2m_max[i] >= 2).length };
    } catch { data = { source: 'Sample values (weather service unreachable)', rainPast14: 38, rainNext7: 12, avgSwingC: 11.5, freezeThawDays: 0 }; }
    data.factor = Math.round((1 + Math.min(data.rainPast14 / 160, 0.25) + Math.min(data.rainNext7 / 120, 0.15) + Math.min(data.avgSwingC / 80, 0.1) + data.freezeThawDays * 0.03) * 100) / 100;
    wx = { at: Date.now(), data }; return data;
  }

  function plan() {
    const orders = readRows('work_orders'), hasWo = new Set(orders.filter(o => o.status !== 'Resolved' && !(o.status === 'New' && o.team === 'Unassigned')).map(o => o.incident));
    const items = scored().filter(x => x.status !== 'Resolved' && !hasWo.has(x.id)).sort((a, b) => b.priority - a.priority);
    const cap = ASSUMPTIONS.stopsPerCrewPerDay, k = clamp(Math.ceil(items.length / cap), 1, 6);
    if (!items.length) return { crews: [], unassigned: 0 };
    const seeds = [items[0]];
    while (seeds.length < k) { let best = null, bd = -1; for (const c of items.slice(0, 40)) { const d = Math.min(...seeds.map(s => km(c, s))); if (d > bd) { bd = d; best = c; } } seeds.push(best); }
    const crews = seeds.map((s, i) => ({ name: `Crew ${String.fromCharCode(65 + i)}`, seed: s, stops: [] })), left = [];
    for (const it of items) { const c = crews.filter(c => c.stops.length < cap).sort((a, b) => km(it, a.seed) - km(it, b.seed))[0]; c ? c.stops.push(it) : left.push(it); }
    return {
      unassigned: left.length,
      crews: crews.filter(c => c.stops.length).map(c => {
        let cur = c.seed, rest = c.stops.slice(), ordered = [], dist = 0;
        while (rest.length) { rest.sort((a, b) => km(cur, a) - km(cur, b)); const n = rest.shift(); dist += km(cur, n); ordered.push(n); cur = n; }
        const mins = ordered.reduce((s, x) => s + (ASSUMPTIONS.minutesPerStop[x.type] || 30), 0);
        return { name: c.name, distanceKm: Math.round(dist * 10) / 10, workMinutes: mins, materials: [...new Set(ordered.map(x => ASSUMPTIONS.materials[x.type]))], stops: ordered.map((x, i) => ({ seq: i + 1, id: x.id, type: x.type, severity: x.severity, location: x.location, lat: x.lat, lng: x.lng, priority: x.priority })) };
      })
    };
  }

  function equity(budget) {
    const all = scored(), out = ZONES.map(z => {
      const inZ = all.filter(x => x.zone === z.id), open = inZ.filter(x => x.status !== 'Resolved'), resolved = inZ.length - open.length;
      const need = open.reduce((s, x) => s + x.priority, 0), spend = z.spend + resolved * 0.05;
      return { id: z.id, name: z.name, population: z.pop, incomeIndex: z.income, calls311: z.calls311, open: open.length, resolved, need, spendLakh: Math.round(spend * 100) / 100, perCapitaInr: Math.round(spend * 1e5 / (z.pop * 1e3) * 10) / 10 };
    });
    const T = k => out.reduce((s, z) => s + z[k], 0) || 1, tn = T('need'), ts = T('spendLakh'), tc = T('calls311');
    out.forEach(z => { z.needShare = z.need / tn; z.spendShare = z.spendLakh / ts; z.callShare = z.calls311 / tc; z.equityRatio = z.needShare ? Math.round(z.spendShare / z.needShare * 100) / 100 : null; z.underserved = z.needShare > 0.03 && z.equityRatio < 0.75; if (budget) z.suggestedLakh = Math.round(z.needShare * budget / 1e5 * 100) / 100; });
    const r = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; const c = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0), d = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0)); return d ? Math.round(c / d * 100) / 100 : null; };
    const spend = out.map(z => z.spendLakh);
    const resolvedItems = all.filter(x => x.status === 'Resolved'), planned = all.filter(x => x.status !== 'Resolved');
    const cost = a => a.reduce((s, x) => s + (ASSUMPTIONS.repairCostInr[x.type] || 2500), 0), avoided = a => Math.round(a.reduce((s, x) => s + x.priority / 100 * ASSUMPTIONS.claimProbabilityAtPriority100 * ASSUMPTIONS.claimCostInr, 0));
    const roi = { repairedCostInr: cost(resolvedItems), repairedAvoidedInr: avoided(resolvedItems), backlogCostInr: cost(planned), backlogAvoidedInr: avoided(planned) };
    return { zones: out, correlation: { spendVsCalls: r(spend, out.map(z => z.calls311)), spendVsNeed: r(spend, out.map(z => z.need)) }, roi, assumptions: ASSUMPTIONS, note: 'Zone population, income index, 311 counts and base spend are illustrative sample data.' };
  }

  async function ingest(b) {
    if (!b || !Array.isArray(b.detections) || typeof b.vehicleId !== 'string' || !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) throw new Error('Send vehicleId, lat, lng and detections[].');
    const vid = b.vehicleId.slice(0, 40), now = new Date().toISOString(), pos = { lat: Number(b.lat), lng: Number(b.lng) };
    const existing = readRows('incidents'), pend = queue(), qIds = new Set(pend.map(x => x.id)), all = [...existing, ...pend], created = [], merged = []; let autoApproved = 0;
    for (const d of b.detections.slice(0, 20)) {
      const type = TYPES.includes(d.type) ? d.type : 'Other', p = { lat: Number(d.lat ?? pos.lat), lng: Number(d.lng ?? pos.lng) };
      const dup = all.find(x => x.type === type && x.status !== 'Resolved' && km(p, x) < 0.03);
      if (dup) {
        dup.sightings = (dup.sightings || 1) + 1; dup.lastSeen = now;
        if (qIds.has(dup.id)) db.prepare('UPDATE detection_queue SET data=? WHERE id=?').run(JSON.stringify(dup), dup.id); else db.prepare('UPDATE incidents SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(dup), now, dup.id);
        merged.push(dup.id); continue;
      }
      const depth = Number(d.depthCm) || 0, sev = d.severity || (depth >= 10 ? 'Critical' : depth >= 6 ? 'High' : 'Medium'), z = nearestZone(p);
      const inc = { id: 'SS-F' + Date.now().toString(36).toUpperCase() + created.length, type, severity: ['Critical', 'High', 'Medium', 'Low'].includes(sev) ? sev : 'Medium', location: `${z.name.split(' (')[0]} · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, lat: p.lat, lng: p.lng, reported: 'just now', confidence: d.confidence != null ? Number(d.confidence) : null, status: 'Open', source: `Footage · ${vid}`, description: `Detected automatically from uploaded footage ${vid}${d.note ? ' (' + d.note + ')' : ''}. Waiting for human review.`, team: 'Unassigned', sightings: 1, depthCm: depth || undefined, sample: Boolean(b.simulated), createdAt: now, frame: d.frame || undefined, review: 'pending' };
      db.prepare('INSERT INTO detection_queue VALUES(?,?,?)').run(inc.id, JSON.stringify(inc), now); all.push(inc); created.push(inc.id);
      if (maybeAutoConfirm(inc)) autoApproved++;
    }
    audit('footage_detections', 'video', vid, { queued: created.length, merged: merged.length });
    return { vehicleId: vid, created, merged, queued: created.length - autoApproved, autoApproved };
  }

  const queue = () => db.prepare('SELECT data FROM detection_queue ORDER BY created_at ASC').all().map(r => JSON.parse(r.data));
  const UNCERTAIN_BELOW = 70;
  function nextWo() { return Math.max(8100, ...readRows('work_orders').map(o => Number(String(o.id).replace(/\D/g, '')) || 0)) + 1; }
  function recordReview(x, outcome, now) { db.prepare('INSERT INTO detection_reviews VALUES(?,?,?,?,?,?)').run(randomUUID(), x.type, typeof x.confidence === 'number' ? x.confidence : null, outcome, x.source || '', now); }
  function confirmEntry(x, patch = {}) {
    const now = new Date().toISOString(), orig = x.type, inc = { ...x, ...patch, review: 'confirmed', reviewedAt: now };
    if (!TYPES.includes(inc.type)) inc.type = 'Other'; if (!['Critical', 'High', 'Medium', 'Low'].includes(inc.severity)) inc.severity = 'Medium';
    db.prepare('INSERT OR REPLACE INTO incidents VALUES(?,?,?)').run(inc.id, JSON.stringify(inc), now); db.prepare('DELETE FROM detection_queue WHERE id=?').run(inc.id);
    const wo = { id: 'WO-' + nextWo(), title: `${inc.type} repair`, incident: inc.id, location: inc.location, priority: inc.severity, status: 'New', team: 'Unassigned', due: ASSUMPTIONS.slaLabel[inc.severity], materials: ASSUMPTIONS.materials[inc.type], auto: true, createdAt: now };
    db.prepare('INSERT INTO work_orders VALUES(?,?,?)').run(wo.id, JSON.stringify(wo), now);
    recordReview({ ...x, type: orig }, inc.type !== orig ? 'corrected' : 'confirmed', now); audit('detection_confirmed', 'incident', inc.id, { workOrder: wo.id, corrected: inc.type !== orig });
    return { incident: inc.id, workOrder: wo.id };
  }
  function decide(b) {
    const row = db.prepare('SELECT data FROM detection_queue WHERE id=?').get(String(b.id || '')); if (!row) throw new Error('That detection is no longer in the queue.');
    const x = JSON.parse(row.data);
    if (b.decision === 'reject') { recordReview(x, 'rejected', new Date().toISOString()); db.prepare('DELETE FROM detection_queue WHERE id=?').run(x.id); if (!frameInUse(x.frame)) rmFile(FRAME_DIR, x.frame); audit('detection_rejected', 'detection', x.id, {}); return { rejected: x.id }; }
    if (b.decision !== 'confirm') throw new Error('decision must be confirm or reject.');
    const patch = {}; if (TYPES.includes(b.type)) patch.type = b.type; if (['Critical', 'High', 'Medium', 'Low'].includes(b.severity)) patch.severity = b.severity;
    return confirmEntry(x, patch);
  }
  function bulkConfirm(min) {
    const m = clamp(Number(min) || 85, 50, 100), list = queue().filter(x => typeof x.confidence === 'number' && x.confidence >= m); list.forEach(x => confirmEntry(x));
    return { confirmed: list.length, minConfidence: m };
  }
  function submitScan(b) {
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!TYPES.includes(b.type) || !['Critical', 'High', 'Medium', 'Low'].includes(b.severity) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Choose a defect type, severity and a location on the map.');
    const now = new Date().toISOString(), id = 'SS-S' + Date.now().toString(36).toUpperCase(), z = nearestZone({ lat, lng });
    let frame; if (b.evidenceId) { const ev = db.prepare('SELECT stored_name FROM evidence WHERE id=?').get(String(b.evidenceId)); if (ev) { frame = `${String(b.evidenceId)}-0${path.extname(ev.stored_name)}`; fs.copyFileSync(path.join(EVIDENCE_DIR, ev.stored_name), path.join(FRAME_DIR, frame)); } }
    const boxes = (Array.isArray(b.boxes) ? b.boxes : []).slice(0, 20).filter(x => Array.isArray(x.bbox) && x.bbox.length === 4 && x.bbox.every(Number.isFinite)).map(x => ({ bbox: x.bbox, label: String(x.label || '').slice(0, 40), confidence: Number.isFinite(x.confidence) ? x.confidence : null }));
    const inc = { id, type: b.type, severity: b.severity, location: String(b.location || '').trim().slice(0, 200) || `${z.name.split(' (')[0]} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, reported: 'just now', confidence: Number.isFinite(b.confidence) ? Math.round(b.confidence * 10) / 10 : null, status: 'Open', source: 'Photo analysis · operator scan', description: 'Image analysed by the detection model.', team: 'Unassigned', createdAt: now, frame, boxes, imgW: Number(b.imgW) || undefined, imgH: Number(b.imgH) || undefined, review: 'pending' };
    if (b.confirm) return { id, ...confirmEntry(inc) };
    db.prepare('INSERT INTO detection_queue VALUES(?,?,?)').run(id, JSON.stringify(inc), now); audit('scan_queued', 'detection', id, {});
    const auto = maybeAutoConfirm(inc); if (auto) return { id, autoApproved: true, ...auto };
    return { id, queued: true };
  }


  function loadSample() {
    if (db.prepare("SELECT COUNT(*) n FROM incidents WHERE data LIKE '%\"sample\":true%'").get().n) return { added: 0 };
    const roads = ['Ring Road', 'Outer Ring Road', 'Main Market Road', 'Block C Lane', 'Colony Marg', 'Sector 7 Road', 'NH-48 Service Road', 'Metro Station Road'], st = ['Open', 'Open', 'Open', 'Assigned', 'Resolved'], sev = ['Critical', 'High', 'Medium', 'Low', 'Medium', 'High'], rep = ['10 min ago', '3 hr ago', '1 day ago', '4 days ago', '6 days ago'];
    let n = 0, now = new Date().toISOString();
    ZONES.forEach((z, zi) => { for (let i = 0; i < 4; i++) { n++; const t = TYPES[(zi + i * 2) % 5], inc = { id: 'SS-D' + String(100 + n), type: t, severity: sev[(n + zi) % 6], location: `${z.name.split(' (')[0]} · ${roads[(n * 3) % roads.length]}`, lat: +(z.lat + Math.sin(n * 7) * 0.012).toFixed(5), lng: +(z.lng + Math.cos(n * 5) * 0.012).toFixed(5), reported: rep[n % 5], confidence: null, status: st[(n * 2) % 5], source: n % 3 === 0 ? 'Citizen report (sample)' : 'Sample AI detection', description: 'Sample record for demonstration.', team: 'Unassigned', sample: true, createdAt: new Date(Date.now() - hoursOpen(rep[n % 5]) * 36e5).toISOString() }; db.prepare('INSERT INTO incidents VALUES(?,?,?)').run(inc.id, JSON.stringify(inc), now); if (inc.status !== 'Open') { const c0 = Date.parse(inc.createdAt), c1 = Math.min(Date.now(), c0 + (1 + n % 5) * 36e5), c2 = Math.min(Date.now(), c1 + (6 + n % 30) * 36e5), done = inc.status === 'Resolved'; const wo = { id: 'WO-S' + n, title: `${inc.type} repair`, incident: inc.id, location: inc.location, priority: inc.severity, status: done ? 'Resolved' : 'Assigned', team: 'Crew ' + 'ABC'[n % 3], due: ASSUMPTIONS.slaLabel[inc.severity], createdAt: new Date(c1).toISOString(), ...(done ? { completedAt: new Date(c2).toISOString() } : {}), sample: true }; db.prepare('INSERT INTO work_orders VALUES(?,?,?)').run(wo.id, JSON.stringify(wo), now); } } });
    [[52, 'Pothole', 'Medium'], [64, 'Damaged sign', 'High'], [78, 'Road crack', 'Low'], [91, 'Pothole', 'Critical']].forEach(([cf, t, sv], i) => { const z = ZONES[(i * 2) % 8], q = { id: 'SS-DQ' + (100 + i), type: t, severity: sv, location: `${z.name.split(' (')[0]} · Sample detection`, lat: +(z.lat + 0.004 * (i + 1)).toFixed(5), lng: +(z.lng - 0.004 * (i + 1)).toFixed(5), reported: 'just now', confidence: cf, status: 'Open', source: 'Sample AI detection', description: 'Sample detection waiting for review.', team: 'Unassigned', sample: true, createdAt: now, review: 'pending' }; db.prepare('INSERT OR IGNORE INTO detection_queue VALUES(?,?,?)').run(q.id, JSON.stringify(q), now); });
    audit('sample_data_loaded', 'incidents', 'bulk', { n }); return { added: n };
  }

  const imgType = { jpeg: '.jpg', png: '.png', webp: '.webp' };
  async function verify(b) {
    const order = readRows('work_orders').find(o => o.id === b.workOrderId); if (!order) throw new Error('Work order not found.');
    if (!['before', 'after'].includes(b.kind) || !/^image\/(jpeg|png|webp)$/.test(b.mimeType || '') || typeof b.base64 !== 'string') throw new Error('Send kind (before|after) and a JPG/PNG/WebP image.');
    const buf = Buffer.from(b.base64, 'base64'); if (!buf.length || buf.length > 8 * 1024 * 1024) throw new Error('Image must be up to 8 MB.');
    const id = randomUUID(), name = id + imgType[b.mimeType.split('/')[1]], now = new Date().toISOString();
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), buf, { flag: 'wx' });
    db.prepare('INSERT INTO verifications VALUES(?,?,?,?,?,?)').run(id, order.id, b.kind, name, String(b.note || '').slice(0, 500), now);
    const kinds = new Set(db.prepare('SELECT kind FROM verifications WHERE work_order_id=?').all(order.id).map(r => r.kind));
    let resolved = false;
    if (kinds.has('before') && kinds.has('after') && order.status !== 'Resolved') {
      db.prepare('UPDATE work_orders SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...order, status: 'Resolved', due: 'Complete', completedAt: now }), now, order.id);
      const inc = db.prepare('SELECT data FROM incidents WHERE id=?').get(order.incident);
      if (inc) db.prepare('UPDATE incidents SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(inc.data), status: 'Resolved' }), now, order.incident);
      resolved = true;
    }
    audit('repair_photo_logged', 'work_order', order.id, { kind: b.kind, resolved });
    return { id, kind: b.kind, resolved };
  }


  const VEXT = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'], MAXV = 300 * 1024 * 1024;
  const jobRow = r => ({ id: r.id, filename: r.filename, status: r.status, message: r.message, params: JSON.parse(r.params || '{}'), result: r.result ? JSON.parse(r.result) : null, createdAt: r.created_at, finishedAt: r.finished_at });
  const finish = (id, status, message, result) => db.prepare('UPDATE video_jobs SET status=?,message=?,result=?,finished_at=? WHERE id=?').run(status, message || null, result ? JSON.stringify(result) : null, new Date().toISOString(), id);
  const sevFromArea = (type, a) => { const k = type === 'Road crack' ? 0.5 : 1; return a * k >= 0.05 ? 'Critical' : a * k >= 0.02 ? 'High' : a * k >= 0.006 ? 'Medium' : 'Low'; };

  async function saveVideo(req, url, user) {
    const MAXB = MAXV;
    const name = String(url.searchParams.get('filename') || 'footage.mp4'), ext = path.extname(name).toLowerCase();
    if (!VEXT.includes(ext)) throw new Error('Upload an MP4, MOV, AVI, MKV or WebM video.');
    const num = k => { const v = url.searchParams.get(k); return v === null || v === '' ? null : Number(v); };
    const params = { startLat: num('startLat'), startLng: num('startLng'), endLat: num('endLat'), endLng: num('endLng'), every: clamp(num('every') || 1, 0.5, 5), userId: user ? user.id : null };
    if (![params.startLat, params.startLng].every(Number.isFinite) || Math.abs(params.startLat) > 90 || Math.abs(params.startLng) > 180) throw new Error('Give the start latitude and longitude of the drive.');
    if (params.endLat !== null && !(Number.isFinite(params.endLat) && Number.isFinite(params.endLng))) throw new Error('End point is incomplete.');
    const id = randomUUID(), file = path.join(VIDEO_DIR, id + ext); let size = 0;
    try {
      await new Promise((ok, bad) => { const ws = fs.createWriteStream(file, { flags: 'wx' }); req.on('data', c => { size += c.length; if (size > MAXB) { bad(new Error(`Video is larger than ${MAXB / 1048576} MB.`)); req.unpipe(ws); ws.destroy(); } }); req.on('error', bad); ws.on('error', bad); ws.on('finish', ok); req.pipe(ws); });
    } catch (e) { fs.rmSync(file, { force: true }); throw e; }
    if (!size) { fs.rmSync(file, { force: true }); throw new Error('The upload was empty.'); }
    db.prepare('INSERT INTO video_jobs(id,filename,status,params,created_at) VALUES(?,?,?,?,?)').run(id, name.slice(0, 120), 'processing', JSON.stringify({ ...params, file: path.basename(file) }), new Date().toISOString());
    runVideo(id, file, params); audit('footage_uploaded', 'video', id, { name, mb: Math.round(size / 1e5) / 10 }); return { jobId: id };
  }

  function runVideo(id, file, params) {
    if (!fs.existsSync(MODEL_PATH)) return finish(id, 'failed', 'No YOLO weights found (models/road_defects.pt).');
    const script = path.join(ROOT, 'ai', 'infer_video.py'), a = [script, '--weights', MODEL_PATH, '--video', file, '--out-dir', FRAME_DIR, '--prefix', id.slice(0, 8), '--every', String(params.every)];
    let out = '', err = '', done = false;
    const end = (st, m, r) => { if (!done) { done = true; clearTimeout(timer); finish(id, st, m, r); } };
    let child; try { child = spawn(PYTHON, PYTHON === 'py' ? ['-3', ...a] : a, { cwd: ROOT, windowsHide: true }); } catch (e) { return end('failed', 'Could not start Python: ' + e.message); }
    const timer = setTimeout(() => { child.kill(); end('failed', 'Processing timed out after 20 minutes.'); }, 20 * 60e3);
    child.stdout.on('data', d => { out += d; if (out.length > 4e6) child.kill(); }); child.stderr.on('data', d => { err = (err + d).slice(-400); });
    child.on('error', e => end('failed', 'Python is not available: ' + e.message));
    child.on('close', async () => {
      let r; try { r = JSON.parse(out.trim().split('\n').pop()); } catch { return end('failed', 'YOLO did not return a result. ' + err.trim()); }
      if (!r.ok) return end('failed', r.message || r.status);
      try {
        const dets = [], skipped = []; const dur = r.durationSec || 1;
        for (const d of r.detections) {
          const c = classifyYolo([{ className: d.className, confidence: d.confidence }]); if (!c || c.type === 'Other') { skipped.push(d.className); continue; }
          const f = clamp(d.timeSec / dur, 0, 1), end2 = params.endLat !== null;
          dets.push({ type: c.type, confidence: Math.round(d.confidence * 100), severity: sevFromArea(c.type, d.areaRatio), lat: params.startLat + (end2 ? (params.endLat - params.startLat) * f : 0), lng: params.startLng + (end2 ? (params.endLng - params.startLng) * f : 0), note: `video ${d.timeSec}s`, frame: d.frame });
        }
        const ing = dets.length ? await ingest({ vehicleId: 'UPLOAD-' + id.slice(0, 6), vehicleType: 'Uploaded footage', lat: params.startLat, lng: params.startLng, detections: dets }) : { created: [], merged: [], queued: 0, autoApproved: 0 };
        const km_ = params.endLat !== null ? km({ lat: params.startLat, lng: params.startLng }, { lat: params.endLat, lng: params.endLng }) : ASSUMPTIONS.avgSurveySpeedKmh * dur / 3600;
        end('done', null, { durationSec: dur, framesAnalysed: r.framesAnalysed, defectsFound: dets.length, created: ing.created.length, merged: ing.merged.length, queued: ing.queued, autoApproved: ing.autoApproved || 0, skippedOther: skipped.length, surveyKm: Math.round(km_ * 100) / 100, locationNote: params.endLat === null ? 'Only a start point was given, so every defect is placed there.' : 'Defect positions are interpolated between start and end.', items: dets.map((d, i) => ({ type: d.type, severity: d.severity, confidence: d.confidence, note: d.note, frame: d.frame })) });
      } catch (e) { end('failed', 'Detections found but saving failed: ' + e.message); }
    });
  }


  function modelInfo() { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(MODEL_PATH), 'model_info.json'), 'utf8')); } catch (_) { return null; } }
  function modelStats() {
    const rows = db.prepare('SELECT type,outcome FROM detection_reviews').all(), c = { confirmed: 0, corrected: 0, rejected: 0 }, byType = {};
    rows.forEach(r => { c[r.outcome]++; const t = byType[r.type] ||= { confirmed: 0, corrected: 0, rejected: 0 }; t[r.outcome]++; });
    const n = rows.length, mi = modelInfo(), v = mi && mi.validation;
    const baseline = mi ? { model: mi.model, dataset: 'RDD2022 India subset plus extra road classes', imageSize: mi.trainingImageSize, epochs: mi.epochs, classes: mi.classes, trainedAt: mi.trainedAt, precisionPct: v.precisionPct, recallPct: v.recallPct, map50Pct: v.map50Pct, map5095Pct: v.map5095Pct, peakPrecisionPct: mi.peakPrecisionAnyEpochPct,
        note: `These scores were recorded inside the model file at the end of training, on its validation images. One training epoch briefly reached ${mi.peakPrecisionAnyEpochPct}% precision, but the saved model scored lower. The model is a helper, so every detection is reviewed by a person.` }
      : { model: 'YOLO11n', dataset: 'RDD2022 India subset', imageSize: null, epochs: null, classes: [], precisionPct: null, recallPct: null, map50Pct: null, map5095Pct: null, peakPrecisionPct: null, note: 'Model scores are not available yet. Run "python ai/model_info.py" once to read them from the model file.' };
    return { baseline,
      live: { reviewed: n, confirmed: c.confirmed, corrected: c.corrected, rejected: c.rejected, confirmRatePct: n ? Math.round(c.confirmed / n * 100) : null, awaitingReview: db.prepare('SELECT COUNT(*) n FROM detection_queue').get().n, byType, note: 'Share of detections a human reviewer confirmed unchanged. A practical precision check, not a full evaluation.' } };
  }
  function rules() {
    return { formula: 'Defect points = base weight × extent factor × speed factor × 0.7 (capped at 100). Condition index = 100 − defect points. Priority = defect points.', baseWeights: BASE, extent: { assumedBySeverity: Object.fromEntries(Object.entries(EXTENT).map(([k, v]) => [k, { depthCm: v[0], widthCm: v[1] }])), factor: 'clamp(0.5 + depth/15 + width/120, 0.5, 2)', note: 'Depth and width are assumed from the severity label unless recorded.' }, speed: { factor: '0.8 + speedLimit/100', estimate: 'Ring roads, marg, expressways, flyovers ≈ 60 km/h; markets, lanes, colonies ≈ 30 km/h; others ≈ 45 km/h unless a speed limit is recorded.' },
      grades: [[85, 'Good'], [70, 'Satisfactory'], [55, 'Fair'], [40, 'Poor'], [25, 'Very poor'], [0, 'Failed']].map(([min, label]) => ({ minConditionIndex: min, label })), repairDeadlines: ASSUMPTIONS.slaLabel,
      liabilityFlags: ['Damaged or missing sign on a road of 40 km/h or more (immediate)', 'Pothole 8 cm or deeper, or Critical, on a road of 40 km/h or more (immediate)', 'Broken streetlight on a road of 45 km/h or more (watch)', 'High-priority hazard (defect points 50+) open more than 72 hours (watch)'],
      humanReview: { uncertainBelowConfidencePct: UNCERTAIN_BELOW, policy: 'Every AI detection waits in a review queue. Nothing becomes an incident, a work order or a public repair until a person confirms it. Uncertain detections are shown first.' } };
  }

  function metrics() {
    const inc = readRows('incidents'), wo = db.prepare('SELECT data,updated_at FROM work_orders').all().map(r => ({ ...JSON.parse(r.data), _u: r.updated_at })), complaints = db.prepare('SELECT COUNT(*) n FROM complaints').get().n;
    const pendingQ = queue(), ai = [...inc, ...pendingQ].filter(x => /^(Footage|Fleet|Sample AI|Sample fleet|Photo analysis)/.test(String(x.source)) || typeof x.confidence === 'number'), human = inc.length + pendingQ.length - ai.length + complaints, confs = ai.map(x => x.confidence).filter(v => typeof v === 'number' && v > 0);
    const byInc = new Map(inc.map(x => [x.id, x])), hrs = (a, b) => (Date.parse(b) - Date.parse(a)) / 36e5, avg = a => a.length ? Math.round(a.reduce((t, v) => t + v, 0) / a.length * 10) / 10 : null, f2o = [], o2d = [], f2d = [];
    for (const o of wo) { const x = byInc.get(o.incident); if (!x || !x.createdAt || !o.createdAt) continue; const a = hrs(x.createdAt, o.createdAt); if (a >= 0) f2o.push(a); const done = o.status === 'Resolved' ? (o.completedAt || o._u) : null; if (done) { const b = hrs(o.createdAt, done), c = hrs(x.createdAt, done); if (b >= 0 && c >= 0) { o2d.push(b); f2d.push(c); } } }
    const s = scored(), grades = {}; s.forEach(x => { grades[x.grade] = (grades[x.grade] || 0) + 1; });
    const kmDone = db.prepare("SELECT result FROM video_jobs WHERE status='done'").all().reduce((t, r) => t + (JSON.parse(r.result || '{}').surveyKm || 0), 0), man = ASSUMPTIONS.manualInspectionInrPerKm, aut = ASSUMPTIONS.automatedInrPerKm, open = s.filter(x => x.status !== 'Resolved');
    return {
      detection: { aiFound: ai.length, humanReported: human, aiSharePct: inc.length + pendingQ.length + complaints ? Math.round(ai.length / (ai.length + human) * 100) : 0, avgConfidence: avg(confs), note: 'Share of defects found by AI versus reported by people. A true detection rate needs a ground-truth survey to compare against.' },
      modelQuality: modelStats().live,
      ttr: { flagToOrderHours: avg(f2o), orderToDoneHours: avg(o2d), flagToDoneHours: avg(f2d), ordersTimed: f2o.length, completedTimed: f2d.length },
      cost: { manualPerKm: man, automatedPerKm: aut, savingPct: Math.round((1 - aut / man) * 100), kmScanned: Math.round(kmDone * 10) / 10 },
      severity: { avgOpenPriority: avg(open.map(x => x.priority)), openCritical: open.filter(x => x.priority >= 75).length, grades, method: 'PCI-style 0-100 condition score from defect type, size and road speed. IRI needs accelerometer or profiler data and is not measured.' }
    };
  }

  const rmFile = (dir, name) => { try { if (name) fs.rmSync(path.join(dir, path.basename(String(name))), { force: true }); } catch (_) { } };
  const frameInUse = f => Boolean(f && db.prepare('SELECT 1 FROM video_jobs WHERE result LIKE ?').get('%' + f + '%'));
  function removeVerifications(woId) { const rows = db.prepare('SELECT stored_name FROM verifications WHERE work_order_id=?').all(woId); rows.forEach(r => rmFile(EVIDENCE_DIR, r.stored_name)); db.prepare('DELETE FROM verifications WHERE work_order_id=?').run(woId); return rows.length; }
  function removeItem(kind, id) {
    const now = new Date().toISOString();
    if (kind === 'incident') {
      const row = db.prepare('SELECT data FROM incidents WHERE id=?').get(id); if (!row) throw new Error('Incident not found.');
      const x = JSON.parse(row.data), wos = readRows('work_orders').filter(o => o.incident === id); let photos = 0;
      wos.forEach(o => { photos += removeVerifications(o.id); db.prepare('DELETE FROM work_orders WHERE id=?').run(o.id); });
      if (!frameInUse(x.frame)) rmFile(FRAME_DIR, x.frame);
      db.prepare('DELETE FROM incidents WHERE id=?').run(id); unlinkComplaint(id); audit('incident_deleted', 'incident', id, { workOrders: wos.length, photos }); return { deleted: id, workOrders: wos.length, photos };
    }
    if (kind === 'work-order') {
      const row = db.prepare('SELECT data FROM work_orders WHERE id=?').get(id); if (!row) throw new Error('Work order not found.');
      const o = JSON.parse(row.data), photos = removeVerifications(id); db.prepare('DELETE FROM work_orders WHERE id=?').run(id);
      const inc = db.prepare('SELECT data FROM incidents WHERE id=?').get(o.incident);
      if (inc) { const x = JSON.parse(inc.data); if (x.status === 'Assigned' || x.status === 'In progress') { db.prepare('UPDATE incidents SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...x, status: 'Open', team: 'Unassigned' }), now, x.id); } }
      audit('work_order_deleted', 'work_order', id, { photos }); return { deleted: id, photos };
    }
    if (kind === 'verification') {
      const v = db.prepare('SELECT work_order_id,stored_name FROM verifications WHERE id=?').get(id); if (!v) throw new Error('Photo not found.');
      rmFile(EVIDENCE_DIR, v.stored_name); db.prepare('DELETE FROM verifications WHERE id=?').run(id);
      const orow = db.prepare('SELECT data FROM work_orders WHERE id=?').get(v.work_order_id); let reopened = false;
      if (orow) { const o = JSON.parse(orow.data); if (o.status === 'Resolved') { const { completedAt, ...rest } = o; db.prepare('UPDATE work_orders SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...rest, status: 'In progress', due: 'Today' }), now, o.id); const inc = db.prepare('SELECT data FROM incidents WHERE id=?').get(o.incident); if (inc) { const x = JSON.parse(inc.data); db.prepare('UPDATE incidents SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...x, status: 'In progress' }), now, x.id); } reopened = true; } }
      audit('repair_photo_deleted', 'work_order', v.work_order_id, { reopened }); return { deleted: id, reopened };
    }
    const j = db.prepare('SELECT params,result FROM video_jobs WHERE id=?').get(id); if (!j) throw new Error('Scan not found.');
    const p = JSON.parse(j.params || '{}'), r = j.result ? JSON.parse(j.result) : null;
    db.prepare('DELETE FROM video_jobs WHERE id=?').run(id); (r ? r.items : []).forEach(i => { if (i.frame && !frameInUseByIncident(i.frame)) rmFile(FRAME_DIR, i.frame); });
    rmFile(VIDEO_DIR, p.file); audit('footage_scan_deleted', 'video', id, {}); return { deleted: id };
  }
  const frameInUseByIncident = f => Boolean(db.prepare('SELECT 1 FROM incidents WHERE data LIKE ?').get('%' + f + '%') || db.prepare('SELECT 1 FROM detection_queue WHERE data LIKE ?').get('%' + f + '%'));

  // ---- Approval mode, approving citizen reports, clearing data ------------------------------------------------
  const getSetting = (k, d) => { const r = db.prepare('SELECT value FROM app_meta WHERE key=?').get(k); return r ? r.value : d; };
  const setSetting = (k, v) => db.prepare('INSERT OR REPLACE INTO app_meta(key,value) VALUES(?,?)').run(k, String(v));
  const approval = () => ({ mode: getSetting('approval_mode', 'manual') === 'auto' ? 'auto' : 'manual', minConfidence: clamp(Number(getSetting('auto_min_confidence', '85')) || 85, 50, 100) });
  function maybeAutoConfirm(inc) {
    const a = approval(); if (a.mode !== 'auto' || typeof inc.confidence !== 'number' || inc.confidence < a.minConfidence) return null;
    try { const r = confirmEntry(inc); audit('detection_auto_approved', 'incident', inc.id, { confidence: inc.confidence }); return r; } catch (_) { return null; }
  }
  const COMPLAINT_TYPE = { 'Pothole': 'Pothole', 'Road crack': 'Road crack', 'Damaged sign': 'Damaged sign', 'Broken streetlight': 'Broken streetlight', 'Blocked drain': 'Blocked drain' };
  const STATUS_FROM_INCIDENT = { Open: 'Under review', Assigned: 'Assigned', 'In progress': 'In progress', Resolved: 'Resolved' };
  const saveComplaint = c => db.prepare('UPDATE complaints SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(c), c.updatedAt = new Date().toISOString(), c.id);
  function approveComplaint(id, by) {
    const row=db.prepare('SELECT data,user_id FROM complaints WHERE id=?').get(complaintMatch[1]);
    const c = JSON.parse(row.data);
    if (c.incidentId) throw new Error('This report is already approved.');
    if (!['Submitted', 'Under review'].includes(c.status)) throw new Error('Only reports that are still waiting can be approved.');
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) throw new Error('This report has no map location, so it cannot become an incident. Ask the reporter for a location.');
    if (db.prepare('SELECT 1 FROM incidents WHERE id=?').get(c.id)) throw new Error('An incident with this ID already exists.');
    const now = new Date().toISOString(), type = COMPLAINT_TYPE[c.category] || 'Other', top = c.aiAnalysis && c.aiAnalysis.detections && c.aiAnalysis.detections[0], conf = top && Number.isFinite(Number(top.confidence)) ? Number(top.confidence) : null;
    const severity = conf === null ? 'Medium' : conf >= 0.85 ? 'High' : conf >= 0.6 ? 'Medium' : 'Low';
    const inc = { id: c.id, type, severity, location: String(c.location).slice(0, 200), lat: c.lat, lng: c.lng, reported: 'just now', confidence: conf === null ? null : Math.round(conf * 1000) / 10, status: 'Open', source: 'Citizen report', description: String(c.description || '').slice(0, 400), team: 'Unassigned', createdAt: c.createdAt || now, review: 'confirmed', reviewedAt: now };
    const wo = { id: 'WO-' + nextWo(), title: `${type} repair`, incident: c.id, location: inc.location, priority: severity, status: 'New', team: 'Unassigned', due: ASSUMPTIONS.slaLabel[severity], materials: ASSUMPTIONS.materials[type], auto: true, createdAt: now };
    db.prepare('INSERT INTO incidents VALUES(?,?,?)').run(inc.id, JSON.stringify(inc), now); db.prepare('INSERT INTO work_orders VALUES(?,?,?)').run(wo.id, JSON.stringify(wo), now);
    c.incidentId = c.id; c.status = 'Under review'; c.approvedAt = now; c.approvedBy = by || 'auto'; saveComplaint(c);
    audit('complaint_approved', 'complaint', c.id, { by: by || 'auto', workOrder: wo.id }); return { incident: inc.id, workOrder: wo.id };
  }
  function autoApproveComplaint(id) {
    if (approval().mode !== 'auto') return null;
    try { const row = db.prepare('SELECT data FROM complaints WHERE id=?').get(id), c = row && JSON.parse(row.data); if (!c || (c.aiAnalysis && c.aiAnalysis.scene && c.aiAnalysis.scene.isRoad === false)) return null; return approveComplaint(id, 'auto'); } catch (_) { return null; }
  }
  function unlinkComplaint(id) {
    const row = db.prepare('SELECT data FROM complaints WHERE id=?').get(id); if (!row) return; const c = JSON.parse(row.data);
    if (c.incidentId) { delete c.incidentId; delete c.approvedAt; delete c.approvedBy; if (c.status !== 'Rejected') c.status = 'Submitted'; saveComplaint(c); }
  }
  // keep a linked report's status in step with its incident (lazy, on every read of reports)
  function syncComplaints() {
    for (const r of db.prepare("SELECT data FROM complaints WHERE data LIKE '%\"incidentId\"%'").all()) {
      const c = JSON.parse(r.data), inc = db.prepare('SELECT data FROM incidents WHERE id=?').get(c.incidentId);
      if (!inc) { unlinkComplaint(c.id); continue; }
      const want = STATUS_FROM_INCIDENT[JSON.parse(inc.data).status]; if (want && c.status !== want && c.status !== 'Rejected' && c.status !== 'Submitted') { c.status = want; saveComplaint(c); }
    }
  }
  // the admin changed a linked report's status by hand: make its incident follow
  function onComplaintStatus(c, status) {
    if (!c.incidentId) return;
    if (status === 'Rejected' || status === 'Submitted') { const keep = status; try { removeItem('incident', c.incidentId); } catch (_) { } delete c.incidentId; delete c.approvedAt; delete c.approvedBy; c.status = keep; return; }
    const inc = db.prepare('SELECT data FROM incidents WHERE id=?').get(c.incidentId); if (!inc) return;
    const map = { 'Under review': 'Open', Assigned: 'Assigned', 'In progress': 'In progress', Resolved: 'Resolved' }, now = new Date().toISOString(), x = JSON.parse(inc.data);
    db.prepare('UPDATE incidents SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...x, status: map[status] }), now, x.id);
    if (status !== 'Under review') for (const o of readRows('work_orders').filter(o => o.incident === x.id)) db.prepare('UPDATE work_orders SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...o, status, ...(status === 'Resolved' ? { due: 'Complete', completedAt: now } : {}) }), now, o.id);
  }
  function clearAllData() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'), dir = path.join(path.dirname(EVIDENCE_DIR), 'backups'); fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `before-clear-${stamp}.sqlite`); db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    const counts = {}; for (const t of ['complaints', 'incidents', 'work_orders', 'detection_queue', 'detection_reviews', 'verifications', 'video_jobs', 'evidence', 'snapshot_history']) { counts[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; db.exec(`DELETE FROM ${t}`); }
    let files = 0; for (const d of [EVIDENCE_DIR, FRAME_DIR, VIDEO_DIR]) { try { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isFile()) { fs.rmSync(p, { force: true }); files++; } } } catch (_) { } }
    setSetting('seed_disabled', '1'); setSetting('last_updated', new Date().toISOString()); audit('all_data_cleared', 'workspace', 'all', { counts, files });
    return { cleared: counts, files, backup: path.basename(backup) };
  }
  function approvalSettings() {
    const w = readRowsRaw('complaints').filter(c => c.status === 'Submitted' && !c.incidentId);
    return { ...approval(), waitingReports: w.length, waitingWithoutLocation: w.filter(c => !Number.isFinite(c.lat) || !Number.isFinite(c.lng)).length, waitingDetections: db.prepare('SELECT COUNT(*) n FROM detection_queue').get().n };
  }
  const readRowsRaw = t => db.prepare(`SELECT data FROM ${t}`).all().map(r => JSON.parse(r.data));

  function impact() {
    const s = scored(), open = s.filter(x => x.status !== 'Resolved'), jobs = db.prepare("SELECT * FROM video_jobs WHERE status='done'").all().map(jobRow);
    const b = { under1d: 0, d1to7: 0, d7to30: 0, over30d: 0 }; open.forEach(x => { const d = x.hoursOpen / 24; d < 1 ? b.under1d++ : d < 7 ? b.d1to7++ : d < 30 ? b.d7to30++ : b.over30d++; });
    const surveyKm = jobs.reduce((t, j) => t + (j.result?.surveyKm || 0), 0), eq = equity(0).roi, orders = readRows('work_orders');
    return {
      operations: { videosProcessed: jobs.length, footageMinutes: Math.round(jobs.reduce((t, j) => t + (j.result?.durationSec || 0), 0) / 6) / 10, surveyKm: Math.round(surveyKm * 10) / 10, manualCostInr: Math.round(surveyKm * ASSUMPTIONS.manualInspectionInrPerKm), automatedCostInr: Math.round(surveyKm * ASSUMPTIONS.automatedInrPerKm), autoWorkOrders: orders.filter(o => o.auto).length },
      detection: { ageBuckets: b, overdue: open.filter(x => x.overdue).length, open: open.length, detectedFromFootage: s.filter(x => x.frame).length },
      safety: { immediateFlags: open.filter(x => x.flags.some(f => f.level === 'immediate')).length, watchFlags: open.filter(x => x.flags.length && !x.flags.some(f => f.level === 'immediate')).length, backlogExposureInr: eq.backlogAvoidedInr },
      assumptions: { manualInspectionInrPerKm: ASSUMPTIONS.manualInspectionInrPerKm, automatedInrPerKm: ASSUMPTIONS.automatedInrPerKm, avgSurveySpeedKmh: ASSUMPTIONS.avgSurveySpeedKmh, slaLabel: ASSUMPTIONS.slaLabel }
    };
  }

  async function adminRoute(req, res, p, url) {
    const m = req.method, sub = p.slice('/api/insights/'.length);
    if (m === 'GET' && sub === 'overview') { const s = scored(), last = db.prepare('SELECT MAX(updated_at) v FROM incidents').get().v; const cr = db.prepare('SELECT data,updated_at FROM complaints').all().map(r => ({ ...JSON.parse(r.data), _u: r.updated_at })).filter(c => ['Submitted', 'Under review'].includes(c.status) && !c.incidentId); return json(res, 200, { queueCount: db.prepare('SELECT COUNT(*) n FROM detection_queue').get().n, version: last + '|' + db.prepare('SELECT COUNT(*) n FROM detection_queue').get().n + '|' + cr.length + '|' + cr.reduce((m, c) => (c._u > m ? c._u : m), ''), citizenReports: cr.map(c => ({ id: c.id, category: c.category, location: c.location, lat: Number.isFinite(c.lat) ? c.lat : null, lng: Number.isFinite(c.lng) ? c.lng : null, status: c.status })), incidents: s, weather: await weather(), zones: ZONES.map(z => ({ id: z.id, name: z.name, lat: z.lat, lng: z.lng, traffic: z.traffic })), flagged: s.filter(x => x.flags.length) }); }
    if (m === 'GET' && sub === 'predict') {
      const w = await weather(), s = scored().filter(x => x.status !== 'Resolved');
      const items = s.map(x => { const z = ZONES.find(z => z.id === x.zone), predicted = clamp(Math.round(x.priority * w.factor * (0.8 + z.traffic / 200)), 0, 100); return { ...x, predicted, velocity: predicted - x.priority }; }).sort((a, b) => b.predicted - a.predicted);
      const zones = ZONES.map(z => { const a = items.filter(x => x.zone === z.id); return { id: z.id, name: z.name, traffic: z.traffic, open: a.length, avgNow: a.length ? Math.round(a.reduce((t, x) => t + x.priority, 0) / a.length) : 0, avgPredicted: a.length ? Math.round(a.reduce((t, x) => t + x.predicted, 0) / a.length) : 0 }; }).sort((a, b) => b.avgPredicted - a.avgPredicted);
      return json(res, 200, { weather: w, zones, items: items.slice(0, 12), method: 'Rule-based heuristic (defect priority x weather stress x traffic). Not trained on historical failure data.' });
    }
    if (m === 'GET' && sub === 'routes') return json(res, 200, plan());
    if (m === 'POST' && sub === 'routes/commit') {
      const pl = plan(), orders = readRows('work_orders'), now = new Date().toISOString();
      let n = Math.max(8100, ...orders.map(o => Number(String(o.id).replace(/\D/g, '')) || 0)), made = 0;
      for (const c of pl.crews) for (const s of c.stops) {
        const prev = orders.find(o => o.incident === s.id && o.status === 'New' && o.team === 'Unassigned'), extra = { status: 'Assigned', team: c.name, due: 'Today', route: { stop: s.seq, lat: s.lat, lng: s.lng }, materials: ASSUMPTIONS.materials[s.type] };
        if (prev) db.prepare('UPDATE work_orders SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...prev, ...extra }), now, prev.id);
        else db.prepare('INSERT INTO work_orders VALUES(?,?,?)').run('WO-' + (++n), JSON.stringify({ id: 'WO-' + n, title: `${s.type} repair (route stop ${s.seq})`, incident: s.id, location: s.location, priority: s.severity, createdAt: now, ...extra }), now);
        const inc = db.prepare('SELECT data FROM incidents WHERE id=?').get(s.id); if (inc) db.prepare('UPDATE incidents SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(inc.data), status: 'Assigned', team: c.name }), now, s.id);
        made++;
      }
      audit('routes_committed', 'work_orders', 'bulk', { made }); return json(res, 201, { made });
    }
    if (m === 'GET' && sub === 'equity') return json(res, 200, equity(Number(url.searchParams.get('budget')) || 0));
    if (m === 'POST' && sub === 'video/upload') { if (!fs.existsSync(MODEL_PATH)) return json(res, 409, { error: 'No YOLO weights found at models/road_defects.pt.' }); return json(res, 202, await saveVideo(req, url, sessionUser(req))); }
    if (m === 'GET' && sub === 'video/jobs') return json(res, 200, { jobs: db.prepare('SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT 20').all().map(jobRow), modelReady: fs.existsSync(MODEL_PATH) });
    const fr = sub.match(/^video\/frame\/([a-f0-9-]+-\d+\.(?:jpg|png|webp))$/i);
    if (m === 'GET' && fr) { const f = path.join(FRAME_DIR, path.basename(fr[1])); if (!fs.existsSync(f)) return json(res, 404, { error: 'Not found' }); res.writeHead(200, { 'Content-Type': { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f)], 'Cache-Control': 'private, max-age=300' }); fs.createReadStream(f).pipe(res); return; }
    if (m === 'GET' && sub === 'review') { const q = queue().sort((a, b) => (typeof a.confidence === 'number' ? a.confidence : -1) - (typeof b.confidence === 'number' ? b.confidence : -1)); return json(res, 200, { items: q.map(x => ({ ...x, uncertain: !(typeof x.confidence === 'number' && x.confidence >= UNCERTAIN_BELOW) })), uncertainBelow: UNCERTAIN_BELOW }); }
    if (m === 'POST' && sub === 'review/decide') return json(res, 200, decide(await bodyJson(req)));
    if (m === 'POST' && sub === 'review/bulk') return json(res, 200, bulkConfirm((await bodyJson(req)).minConfidence));
    if (m === 'POST' && sub === 'review/submit') return json(res, 201, submitScan(await bodyJson(req)));
    { const dm = m === 'DELETE' && sub.match(/^(incident|work-order|verification|video-job)\/([A-Za-z0-9-]+)$/); if (dm) return json(res, 200, removeItem(dm[1], dm[2])); }
    if (m === 'GET' && sub === 'work-orders') { const inc = new Map(readRows('incidents').map(x => [x.id, x])); return json(res, 200, { items: readRows('work_orders').map(o => ({ id: o.id, title: o.title, status: o.status, team: o.team, due: o.due, incident: o.incident, location: o.location || (inc.get(o.incident) || {}).location || '' })) }); }
    if (m === 'GET' && sub === 'settings') return json(res, 200, approvalSettings());
    if (m === 'PUT' && sub === 'settings') {
      const b = await bodyJson(req); if (!['manual', 'auto'].includes(b.mode)) throw new Error('Mode must be manual or auto.');
      const min = Number(b.minConfidence); if (!Number.isFinite(min) || min < 50 || min > 100) throw new Error('The confidence threshold must be between 50 and 100.');
      setSetting('approval_mode', b.mode); setSetting('auto_min_confidence', min); audit('approval_mode_changed', 'settings', 'approval', { mode: b.mode, minConfidence: min }); return json(res, 200, approvalSettings());
    }
    { const am = m === 'POST' && sub.match(/^complaints\/([A-Za-z0-9-]+)\/approve$/); if (am) return json(res, 200, approveComplaint(am[1], 'admin')); }
    if (m === 'POST' && sub === 'complaints/approve-all') { let ok = 0, skipped = 0; for (const c of readRowsRaw('complaints').filter(c => c.status === 'Submitted' && !c.incidentId)) { try { approveComplaint(c.id, 'admin'); ok++; } catch (_) { skipped++; } } return json(res, 200, { approved: ok, skipped }); }
    if (m === 'POST' && sub === 'clear-data') { const b = await bodyJson(req); if (b.confirm !== 'DELETE ALL DATA') throw new Error('Type DELETE ALL DATA to confirm.'); return json(res, 200, clearAllData()); }
    if (m === 'GET' && sub === 'impact') return json(res, 200, impact());
    if (m === 'GET' && sub === 'metrics') return json(res, 200, metrics());
    if (m === 'GET' && sub === 'crew') { const inc = new Map(readRows('incidents').map(x => [x.id, x])); return json(res, 200, { orders: readRows('work_orders').filter(o => o.status !== 'Resolved' && o.team && o.team !== 'Unassigned').map(o => { const x = inc.get(o.incident) || {}; return { id: o.id, title: o.title, team: o.team, status: o.status, due: o.due, location: o.location || x.location, lat: x.lat, lng: x.lng, stop: o.route ? o.route.stop : null, materials: o.materials || ASSUMPTIONS.materials[x.type] || '', incident: o.incident, severity: x.severity }; }) }); }
    if (m === 'POST' && sub === 'sample-data') return json(res, 201, loadSample());
    if (m === 'POST' && sub === 'verify') return json(res, 201, await verify(await bodyJson(req)));
    if (m === 'GET' && sub === 'verifications') {
      const rows = db.prepare('SELECT id,work_order_id AS workOrderId,kind,stored_name AS file,note,created_at AS createdAt FROM verifications ORDER BY created_at DESC LIMIT 200').all();
      return json(res, 200, { items: rows, orders: readRows('work_orders').map(o => ({ id: o.id, title: o.title, status: o.status, location: o.location })) });
    }
    const img = sub.match(/^verification-image\/([a-f0-9-]+\.(?:jpg|png|webp))$/i);
    if (m === 'GET' && img) {
      const f = path.join(EVIDENCE_DIR, path.basename(img[1]));
      if (!fs.existsSync(f)) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f)], 'Cache-Control': 'private, max-age=300' }); fs.createReadStream(f).pipe(res); return true;
    }
    json(res, 404, { error: 'Insights route not found' }); return true;
  }

  async function admin(req, res, p, url) { if (!p.startsWith('/api/insights/')) return false; await adminRoute(req, res, p, url); return true; }

  async function pub(req, res, p, url) {
    if (req.method !== 'GET') return false;
    if (p === '/api/public/rules') { json(res, 200, rules()); return true; }
    if (p === '/api/public/model-stats') { json(res, 200, modelStats()); return true; }
    if (p === '/api/public/repairs') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase(), orders = readRows('work_orders');
      let items = scored().filter(x => x.status !== 'Resolved');
      if (q.length >= 2) items = items.filter(x => (x.location + ' ' + x.zoneName + ' ' + x.type).toLowerCase().includes(q));
      const LIVE = ['Submitted', 'Under review', 'Assigned', 'In progress'];
      let reports = db.prepare('SELECT data FROM complaints ORDER BY created_at DESC LIMIT 300').all().map(r => JSON.parse(r.data)).filter(c => LIVE.includes(c.status) && !c.incidentId).map(c => ({ id: 'Citizen report', type: String(c.category || 'Report').slice(0, 60), location: String(c.location || '').slice(0, 120), lat: Number.isFinite(c.lat) ? c.lat : null, lng: Number.isFinite(c.lng) ? c.lng : null, status: c.status === 'Submitted' ? 'Received' : c.status, scheduled: c.status === 'In progress' ? 'Repair under way' : c.status === 'Assigned' ? 'Crew assigned' : 'Awaiting review', crew: c.status === 'Assigned' || c.status === 'In progress' ? 'Crew assigned' : 'Not yet assigned', citizen: true }));
      if (q.length >= 2) reports = reports.filter(x => (x.location + ' ' + x.type).toLowerCase().includes(q));
      return json(res, 200, { reports: reports.slice(0, 60), items: items.slice(0, 60).map(x => { const o = orders.find(o => o.incident === x.id && o.status !== 'Resolved'); return { id: x.id, type: x.type, location: x.location, lat: x.lat, lng: x.lng, status: x.status, scheduled: o ? (o.due && o.due !== 'Unscheduled' ? o.due : 'Date to be confirmed') : 'Awaiting scheduling', crew: o && o.team && o.team !== 'Unassigned' ? 'Crew assigned' : 'Not yet assigned', sample: x.sample }; }) }) || true;
    }
    if (p === '/api/public/impact') {
      const s = scored(), orders = readRows('work_orders'), done = s.filter(x => x.status === 'Resolved');
      const crews = new Set(orders.filter(o => o.status !== 'Resolved' && o.team && o.team !== 'Unassigned').map(o => o.team));
      const saved = Math.round(done.reduce((t, x) => t + x.priority / 100 * ASSUMPTIONS.claimProbabilityAtPriority100 * ASSUMPTIONS.claimCostInr, 0));
      return json(res, 200, { potholesFilled: done.filter(x => x.type === 'Pothole').length, repairsCompleted: done.length, openReports: s.length - done.length, activeCrews: crews.size, estimatedSavedInr: saved, basis: 'Estimated avoided claim exposure using stated assumptions, not audited savings.' }) || true;
    }
    return false;
  }
  return { admin, pub, syncComplaints, autoApproveComplaint, onComplaintStatus };
};
