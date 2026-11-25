
"use strict";

const { calculateSeverity } =
    require("./severity-scoring");

const testComplaints = [
    {
        id: "TEST-001",
        category: "pothole",
        aiAnalysis: {
            detections: [
                { confidence: 0.92 }
            ]
        }
    },
    {
        id: "TEST-002",
        category: "longitudinal crack",
        aiAnalysis: {
            detections: [
                { confidence: 0.70 }
            ]
        }
    },
    {
        id: "TEST-003",
        category: "road collapse",
        aiAnalysis: {
            detections: [
                { confidence: 0.98 }
            ]
        }
    }
];

for (const complaint of testComplaints) {
    console.log(
        calculateSeverity(complaint)
    );
}
