'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tbl = (h, rows) => `<table><tr>${h.map(x => `<th>${esc(x)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`;
async function load() {
  try {
    const [r, m] = await Promise.all([fetch('/api/public/rules', { cache: 'no-store' }).then(x => x.json()), fetch('/api/public/model-stats', { cache: 'no-store' }).then(x => x.json())]);
    $('policy').textContent = r.humanReview.policy; $('formula').textContent = r.formula;
    $('weights').innerHTML = tbl(['Defect type', 'Base weight'], Object.entries(r.baseWeights));
    $('grades').innerHTML = tbl(['Condition index', 'Grade'], r.grades.map(g => ['≥ ' + g.minConditionIndex, g.label]));
    $('sla').innerHTML = tbl(['Severity', 'Repair deadline'], Object.entries(r.repairDeadlines));
    $('flags').innerHTML = r.liabilityFlags.map(f => `<li>${esc(f)}</li>`).join('');
    $('extentnote').textContent = `Extent factor: ${r.extent.factor}. Speed factor: ${r.speed.factor}. ${r.extent.note} ${r.speed.estimate}`;
    const b = m.baseline, l = m.live;
    $('base').innerHTML = `<p><b>${esc(b.model)}</b> trained on the ${esc(b.dataset)}, images resized to ${b.imageSize} px.</p><p>Precision: <b>about ${b.precisionPct}%</b><br>Recall: ${esc(b.recall)}<br>mAP@0.5: ${esc(b.map50)}</p><p class="mute">${esc(b.note)}</p>`;
    $('live').innerHTML = l.reviewed ? `<p><b>${l.confirmRatePct}%</b> of ${l.reviewed} reviewed detections were confirmed unchanged (${l.confirmed} confirmed, ${l.corrected} corrected, ${l.rejected} rejected).</p><p class="mute">${l.awaitingReview} waiting for review. ${esc(l.note)}</p>` : `<p>No detections have been reviewed yet. ${l.awaitingReview} waiting for review.</p><p class="mute">${esc(l.note)}</p>`;
  } catch { $('policy').textContent = 'Could not load the live rules. Is the server running?'; }
}
load();
