
const fs = require('fs');

const file = 'admin.js';
let source = fs.readFileSync(file, 'utf8');

const marker = 'async function openComplaint(id){';

if (!source.includes(marker)) {
    throw new Error('Could not find openComplaint function.');
}

if (source.includes('function renderAIAnalysis(c)')) {
    throw new Error('AI renderer already exists.');
}

const helper = `
function renderAIAnalysis(c) {
    const ai = c.aiAnalysis || {};
    const detections = Array.isArray(ai.detections) ? ai.detections : [];
    const status = String(ai.status || 'not_available');

    const cards = detections.length
        ? detections.slice(0, 10).map(d => {
            const confidence = Number(d.confidence);
            const score = Number.isFinite(confidence)
                ? (confidence * 100).toFixed(1) + '% confidence'
                : 'Confidence unavailable';

            return '<div class="ai-detection"><b>' +
                esc(d.className || 'Unknown') +
                '</b><span>' + score + '</span></div>';
        }).join('')
        : '<p>No detections available for this report.</p>';

    return '<section class="admin-ai">' +
        '<div class="eyebrow"><i></i> STREET SENSE AI ANALYSIS</div>' +
        '<p>AI STATUS: <b>' + esc(status) + '</b></p>' +
        cards +
        (ai.prediction
            ? '<p>SUGGESTED CATEGORY: <b>' +
                esc(ai.prediction.type || 'Not available') +
                '</b></p>'
            : '') +
        (ai.message ? '<p>' + esc(ai.message) + '</p>' : '') +
        '<p class="ai-review-note">' +
        'AI predictions are preliminary and require human verification.' +
        '</p></section>';
}

`;

source = source.replace(marker, helper + marker);

const insertionPoint = '${coords}${img}<p';

if (!source.includes(insertionPoint)) {
    throw new Error('Complaint details insertion point not found.');
}

source = source.replace(
    insertionPoint,
    '${coords}${img}${renderAIAnalysis(c)}<p'
);

fs.writeFileSync(file, source, 'utf8');

console.log('ADMIN AI ANALYSIS RENDERER ADDED');
