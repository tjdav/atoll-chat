CREATE INDEX IF NOT EXISTS idx_server_invites_created_by
    ON server_invites(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_server_invites_active
    ON server_invites(code)
    WHERE revoked_at IS NULL;
