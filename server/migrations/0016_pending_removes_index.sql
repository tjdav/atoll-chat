CREATE INDEX IF NOT EXISTS idx_pending_mls_removes_active
    ON pending_mls_removes(room_id, consumed_at)
    WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_mls_removes_pending
    ON pending_mls_removes(room_id, queued_at ASC)
    WHERE consumed_at IS NULL;
