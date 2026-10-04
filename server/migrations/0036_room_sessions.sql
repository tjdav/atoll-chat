CREATE TABLE IF NOT EXISTS room_sessions (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    extension_id     TEXT NOT NULL,
    session_type     TEXT NOT NULL,
    metadata         TEXT,
    metadata_version INTEGER NOT NULL DEFAULT 1,
    position         INTEGER NOT NULL,
    created_by       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_room_sessions_room_pos
    ON room_sessions(room_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_room_sessions_created_by
    ON room_sessions(created_by);
