
"use strict";

const { DatabaseSync } = require("node:sqlite");
const { createDuplicateService } = require("./duplicate-service");

const db = new DatabaseSync("data/streetsense.sqlite");

try {
    const service = createDuplicateService(db);

    const testComplaint = {
        id: "STREETSENSE-TEST-001",
        category: "pothole",
        lat: 28.6139,
        lng: 77.2090
    };

    const matches = service.checkComplaint(testComplaint);

    console.log("Duplicate detection test completed.");
    console.log("Potential matches:", matches.length);
    console.log(matches);

} catch (error) {
    console.error("Test failed:", error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
