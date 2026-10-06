CREATE TABLE IF NOT EXISTS attachments (
  file_id             TEXT PRIMARY KEY,
  room_id             TEXT,
  purpose             TEXT NOT NULL,
  content_type        TEXT,
  plaintext_size      INTEGER,
  encrypted_size      INTEGER,
  thumbnail_file_id   TEXT,
  duration_ms         INTEGER,
  uploaded_at         INTEGER,
  downloaded_at       INTEGER,
  cached_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_room ON attachments(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_purpose ON attachments(purpose);

CREATE TABLE IF NOT EXISTS reactions (
  message_id          TEXT NOT NULL,
  sender_user_id      TEXT NOT NULL,
  sender_client_id    TEXT NOT NULL,
  reaction            TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  PRIMARY KEY (message_id, sender_user_id, sender_client_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(sender_user_id);
