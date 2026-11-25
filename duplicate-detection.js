
"use strict";

function distanceInMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = value => value * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validCoordinates(lat, lng) {
    return Number.isFinite(Number(lat)) &&
        Number.isFinite(Number(lng)) &&
        Number(lat) >= -90 &&
        Number(lat) <= 90 &&
        Number(lng) >= -180 &&
        Number(lng) <= 180;
}

function findPotentialDuplicates(
    newComplaint,
    existingRows,
    options = {}
) {
    const radiusMeters = options.radiusMeters ?? 100;
    const results = [];

    if (!newComplaint ||
        !validCoordinates(newComplaint.lat, newComplaint.lng)) {
        return results;
    }

    const newCategory = String(newComplaint.category || "")
        .trim()
        .toLowerCase();

    if (!newCategory) return results;

    for (const row of existingRows) {
        try {
            const existing = typeof row.data === "string"
                ? JSON.parse(row.data)
                : row.data;

            if (!existing || existing.id === newComplaint.id) continue;

            if (!validCoordinates(existing.lat, existing.lng)) continue;

            const existingCategory = String(existing.category || "")
                .trim()
                .toLowerCase();

            if (existingCategory !== newCategory) continue;

            const distance = distanceInMeters(
                Number(newComplaint.lat),
                Number(newComplaint.lng),
                Number(existing.lat),
                Number(existing.lng)
            );

            if (distance <= radiusMeters) {
                results.push({
                    complaintId: existing.id,
                    category: existing.category,
                    distanceMeters: Math.round(distance),
                    similarityScore: Math.round(
                        100 * (1 - distance / radiusMeters)
                    )
                });
            }
        } catch {
            // Ignore malformed historical records.
        }
    }

    return results.sort(
        (a, b) => a.distanceMeters - b.distanceMeters
    );
}

module.exports = {
    distanceInMeters,
    findPotentialDuplicates
};
