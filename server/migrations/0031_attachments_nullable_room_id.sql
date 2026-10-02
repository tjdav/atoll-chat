-- Make room_id nullable in attachments table to support user-scoped attachments
CREATE TABLE attachments_new (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT REFERENCES rooms(id) ON DELETE CASCADE,
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

INSERT INTO attachments_new SELECT * FROM attachments;

DROP TABLE attachments;

ALTER TABLE attachments_new RENAME TO attachments;

CREATE INDEX idx_attachments_room_created
    ON attachments(room_id, created_at DESC);

CREATE INDEX idx_attachments_uploader_created
    ON attachments(uploader_id, created_at DESC);

CREATE INDEX idx_attachments_created
    ON attachments(created_at);
