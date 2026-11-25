
"use strict";

const { DatabaseSync } = require("node:sqlite");
const { createSeverityService } =
    require("./severity-service");

const db = new DatabaseSync(
    "data/streetsense.sqlite"
);

try {
    const service = createSeverityService(db);

    const complaint = {
        id: "SEVERITY-TEST-001",
        category: "pothole",
        aiAnalysis: {
            detections: [
                { confidence: 0.92 }
            ]
        }
    };

    const result = service.saveSeverity(complaint);

    console.log("Severity saved successfully.");
    console.log(result);

} catch (error) {
    console.error("Test failed:", error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
