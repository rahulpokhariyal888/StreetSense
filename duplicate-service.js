
"use strict";

const { randomUUID } = require("node:crypto");
const { findPotentialDuplicates } = require("./duplicate-detection");

function createDuplicateService(db) {
    if (!db || typeof db.prepare !== "function") {
        throw new Error("A valid SQLite database connection is required");
    }

    const findRows = db.prepare(`
        SELECT data FROM complaints
    `);

    const findExisting = db.prepare(`
        SELECT 1
        FROM complaint_duplicates
        WHERE complaint_id = ?
          AND possible_duplicate_id = ?
        LIMIT 1
    `);

    const insertDuplicate = db.prepare(`
        INSERT INTO complaint_duplicates (
            id,
            complaint_id,
            possible_duplicate_id,
            similarity_score,
            review_status
        )
        VALUES (?, ?, ?, ?, 'pending')
    `);

    function checkComplaint(complaint) {
        const existingRows = findRows.all();

        const matches = findPotentialDuplicates(
            complaint,
            existingRows,
            { radiusMeters: 100 }
        );

        db.exec("BEGIN IMMEDIATE");

        try {
            for (const match of matches) {
                const alreadyExists = findExisting.get(
                    complaint.id,
                    match.complaintId
                );

                if (!alreadyExists) {
                    insertDuplicate.run(
                        randomUUID(),
                        complaint.id,
                        match.complaintId,
                        match.similarityScore
                    );
                }
            }

            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }

        return matches;
    }

    return { checkComplaint };
}

module.exports = { createDuplicateService };
