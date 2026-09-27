CREATE TABLE IF NOT EXISTS room_invites (
    id           TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    code         TEXT NOT NULL UNIQUE,
    created_by   TEXT NOT NULL REFERENCES users(id),
    max_uses     INTEGER NOT NULL,
    current_uses INTEGER NOT NULL DEFAULT 0,
    expires_at   DATETIME,
    revoked_at   DATETIME,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_room_invites_room_active
    ON room_invites(room_id, created_at DESC)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_room_invites_code
    ON room_invites(code);
