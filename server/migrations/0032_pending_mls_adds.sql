CREATE TABLE pending_mls_adds (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    target_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_client_id TEXT NOT NULL,
    key_package_id   TEXT NOT NULL REFERENCES key_packages(id),
    queued_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at      DATETIME
);

CREATE INDEX idx_pending_mls_adds_active
    ON pending_mls_adds(room_id, consumed_at)
    WHERE consumed_at IS NULL;
