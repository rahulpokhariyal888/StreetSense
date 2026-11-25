
"use strict";

const CATEGORY_WEIGHTS = {
    pothole: 75,
    "deep pothole": 90,
    "alligator crack": 85,
    "road collapse": 100,
    "road edge breakage": 85,
    waterlogging: 70,
    rutting: 70,
    "failed repair patch": 65,
    "asphalt ravelling": 55,
    "surface bleeding": 50,
    "longitudinal crack": 45,
    "transverse crack": 45,
    crack: 40
};

function getConfidence(complaint) {
    const analysis = complaint.aiAnalysis || {};

    const detections = Array.isArray(analysis.detections)
        ? analysis.detections
        : [];

    const values = detections
        .map(item => Number(item.confidence))
        .filter(Number.isFinite)
        .map(value => value > 1 ? value / 100 : value)
        .filter(value => value >= 0 && value <= 1);

    if (values.length > 0) {
        return Math.max(...values);
    }

    const prediction = Number(analysis.prediction);

    if (Number.isFinite(prediction) && prediction >= 0) {
        return prediction > 1 ? prediction / 100 : prediction;
    }

    return null;
}

function calculateSeverity(complaint) {
    if (!complaint || typeof complaint !== "object") {
        throw new Error("A valid complaint is required");
    }

    const category = String(complaint.category || "")
        .trim()
        .toLowerCase();

    const baseScore = CATEGORY_WEIGHTS[category] ?? 40;
    const confidence = getConfidence(complaint);

    // Missing AI confidence does not automatically lower severity.
    const confidenceScore = confidence === null
        ? 0.75
        : confidence;

    let score = baseScore * 0.75 +
        confidenceScore * 25;

    // Older unresolved complaints receive a limited urgency bonus.
    const createdAt = complaint.createdAt ||
        complaint.created_at;

    if (createdAt) {
        const age = Date.now() - new Date(createdAt).getTime();

        if (Number.isFinite(age) && age > 0) {
            const ageDays = age / 86400000;
            score += Math.min(ageDays * 0.5, 15);
        }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let recommendation;

    if (score >= 85) {
        recommendation = "Critical";
    } else if (score >= 65) {
        recommendation = "High";
    } else if (score >= 40) {
        recommendation = "Medium";
    } else {
        recommendation = "Low";
    }

    return {
        complaintId: complaint.id || null,
        category: category || "unknown",
        score,
        recommendation,
        confidence,
        explanation: [
            `Category baseline: ${baseScore}/100`,
            confidence === null
                ? "AI confidence unavailable; neutral estimate used"
                : `AI confidence: ${Math.round(confidence * 100)}%`,
            "Complaint age contributes a limited urgency adjustment",
            "This is a recommendation, not an automatic final priority"
        ]
    };
}

module.exports = {
    calculateSeverity
};
