-- Definitions for rooms, room_members, room_epochs, key_packages, pending_mls_removes
CREATE TABLE IF NOT EXISTS rooms (
    id                   TEXT PRIMARY KEY,
    owner_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name_encrypted       TEXT,
    retention_days       INTEGER,
    max_file_size_bytes  INTEGER,
    moderation_override  TEXT,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_members (
    room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',
    joined_via  TEXT,
    joined_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_epochs (
    room_id    TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    epoch      INTEGER NOT NULL DEFAULT 0,
    sequence   INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
