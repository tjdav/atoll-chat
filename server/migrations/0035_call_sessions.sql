CREATE TABLE IF NOT EXISTS call_sessions (
    id           TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    initiator_id TEXT NOT NULL REFERENCES users(id),
    started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at     DATETIME
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_room
    ON call_sessions(room_id, started_at DESC);

CREATE TABLE IF NOT EXISTS call_participants (
    call_id   TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at   DATETIME,
    PRIMARY KEY (call_id, user_id)
);
