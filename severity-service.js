
"use strict";

const { randomUUID } = require("node:crypto");
const { calculateSeverity } = require("./severity-scoring");

function createSeverityService(db) {
    if (!db || typeof db.prepare !== "function") {
        throw new Error("A valid SQLite connection is required");
    }

    const insertSeverity = db.prepare(`
        INSERT INTO complaint_severity (
            id,
            complaint_id,
            score,
            recommendation,
            explanation,
            reviewed_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    function saveSeverity(complaint, reviewedBy = null) {
        const result = calculateSeverity(complaint);

        if (!complaint.id) {
            throw new Error("Complaint ID is required");
        }

        insertSeverity.run(
            randomUUID(),
            complaint.id,
            result.score,
            result.recommendation,
            JSON.stringify(result.explanation),
            reviewedBy
        );

        return result;
    }

    return { saveSeverity };
}

module.exports = { createSeverityService };
