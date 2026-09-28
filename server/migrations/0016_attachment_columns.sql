-- Extend attachments table schema for phase 12a
DROP TABLE IF EXISTS attachments;

CREATE TABLE attachments (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    uploader_id        TEXT NOT NULL REFERENCES users(id),
    uploader_client_id TEXT,
    storage_backend    TEXT NOT NULL CHECK(storage_backend IN ('fs', 's3')),
    storage_key        TEXT NOT NULL,
    padded_size        INTEGER NOT NULL,
    plaintext_size     INTEGER NOT NULL,
    encrypted_size     INTEGER NOT NULL,
    chunk_size         INTEGER NOT NULL,
    chunk_count        INTEGER NOT NULL,
    nonce_prefix       TEXT NOT NULL,
    base_counter       INTEGER NOT NULL,
    content_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_attachments_room_created
    ON attachments(room_id, created_at DESC);

CREATE INDEX idx_attachments_uploader_created
    ON attachments(uploader_id, created_at DESC);

CREATE INDEX idx_attachments_created
    ON attachments(created_at);
