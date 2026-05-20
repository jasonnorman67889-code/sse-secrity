-- Correlation Engine schema for Spam/Identity cross-plane detections

CREATE TABLE IF NOT EXISTS spam_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    url_clicked INTEGER NOT NULL DEFAULT 0,
    campaign_id TEXT,
    timestamp INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_spam_events_user_ts ON spam_events (user_id, timestamp);

CREATE TABLE IF NOT EXISTS identity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    node_id TEXT NOT NULL,
    metadata TEXT,
    timestamp INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_identity_logs_user_type_ts ON identity_logs (user_id, type, timestamp);
