CREATE TABLE IF NOT EXISTS messages (
  message_id        TEXT PRIMARY KEY,
  room_id           TEXT NOT NULL,
  sender_user_id    TEXT NOT NULL,
  sender_client_id  TEXT NOT NULL,
  epoch             INTEGER NOT NULL,
  seq               INTEGER NOT NULL,
  content_type      TEXT NOT NULL,
  ciphertext        BLOB NOT NULL,
  decrypted_payload TEXT,
  reply_to          TEXT,
  edited_at         INTEGER,
  deleted_at        INTEGER,
  expires_at        INTEGER,
  local_status      TEXT NOT NULL DEFAULT 'sent',
  local_error       TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_room_epoch_seq
  ON messages(room_id, epoch DESC, seq DESC);

CREATE INDEX IF NOT EXISTS idx_messages_room_created
  ON messages(room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_expires_at
  ON messages(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON messages(reply_to)
  WHERE reply_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_versions (
  message_id        TEXT NOT NULL,
  edit_sequence     INTEGER NOT NULL,
  ciphertext        BLOB NOT NULL,
  decrypted_payload TEXT,
  edited_at         INTEGER NOT NULL,
  PRIMARY KEY (message_id, edit_sequence)
);

CREATE INDEX IF NOT EXISTS idx_message_versions_message
  ON message_versions(message_id, edit_sequence ASC);
