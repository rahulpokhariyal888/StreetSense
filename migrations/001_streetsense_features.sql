
-- StreetSense Feature Expansion
-- Migration 001
-- Compatible with the existing TEXT-based IDs and JSON records.

CREATE TABLE IF NOT EXISTS repair_updates (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL,
    work_order_id TEXT,
    status TEXT NOT NULL,
    note TEXT DEFAULT '',
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    notification_type TEXT DEFAULT 'status_update',
    related_complaint_id TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_assignments (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL,
    work_order_id TEXT,
    department_id TEXT,
    contractor_name TEXT,
    assigned_by TEXT,
    status TEXT NOT NULL DEFAULT 'assigned',
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS complaint_severity (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL,
    score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
    recommendation TEXT NOT NULL,
    explanation TEXT,
    reviewed_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS complaint_duplicates (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL,
    possible_duplicate_id TEXT NOT NULL,
    similarity_score REAL,
    review_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(complaint_id <> possible_duplicate_id)
);

CREATE TABLE IF NOT EXISTS departments_activity (
    id TEXT PRIMARY KEY,
    department_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_repair_updates_complaint
ON repair_updates(complaint_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user
ON notifications(user_id, is_read);

CREATE INDEX IF NOT EXISTS idx_assignments_complaint
ON work_assignments(complaint_id);

CREATE INDEX IF NOT EXISTS idx_assignments_department
ON work_assignments(department_id);

CREATE INDEX IF NOT EXISTS idx_severity_complaint
ON complaint_severity(complaint_id);

CREATE INDEX IF NOT EXISTS idx_duplicates_complaint
ON complaint_duplicates(complaint_id);
