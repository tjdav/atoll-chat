CREATE INDEX IF NOT EXISTS idx_pending_mls_removes_pending
    ON pending_mls_removes(room_id, queued_at ASC)
    WHERE consumed_at IS NULL;
