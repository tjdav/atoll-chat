CREATE TABLE IF NOT EXISTS welcomes (
    id                  TEXT PRIMARY KEY,
    room_id             TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    recipient_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_client_id TEXT NOT NULL,
    welcome_data        BLOB NOT NULL,
    consumed            INTEGER NOT NULL DEFAULT 0,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_welcomes_recipient
    ON welcomes(recipient_user_id, consumed, created_at DESC);
