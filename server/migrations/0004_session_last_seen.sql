ALTER TABLE sessions ADD COLUMN last_seen_at DATETIME;

ALTER TABLE users ADD COLUMN display_name TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
    ON sessions(user_id, expires_at)
    WHERE revoked_at IS NULL;
