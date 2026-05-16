-- Migration 0009: dsr_audit_log table
-- TICKET-GDPR-002 — Data Subject Rights endpoints
--
-- Tracks all DSR requests for regulatory audit purposes.
-- The email address of the data subject is SHA-256 hashed at the application layer
-- before insertion — raw email is NEVER stored in ClickHouse.
--
-- Partitioned by month (toYYYYMM) for efficient range-delete when tenants are removed.
-- Ordered by (tenant_id, session_id, requested_at) for the most common access pattern.

CREATE TABLE IF NOT EXISTS dsr_audit_log
(
    id          UUID DEFAULT generateUUIDv4(),
    tenant_id   String,
    session_id  String,
    dsr_type    LowCardinality(String),
    action      LowCardinality(String),   -- 'initiated', 'completed', 'expired', 'failed'
    email_hash  String,                   -- SHA-256 of email (never store raw email in CH)
    requested_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC'))
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(requested_at)
ORDER BY (tenant_id, session_id, requested_at);
