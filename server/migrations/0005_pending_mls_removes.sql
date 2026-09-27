-- Placeholder definitions for rooms, room_members, and key_packages if they do not yet exist
CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_members (
    room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS key_packages (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id   TEXT NOT NULL,
    key_package BLOB NOT NULL,
    consumed    INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_mls_removes (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    target_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_client_id TEXT NOT NULL,
    queued_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at      DATETIME
);

CREATE INDEX IF NOT EXISTS idx_pending_mls_removes_active
    ON pending_mls_removes(room_id, consumed_at)
    WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
