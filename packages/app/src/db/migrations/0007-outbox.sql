CREATE TABLE IF NOT EXISTS outbox (
  message_id        TEXT PRIMARY KEY,
  room_id           TEXT NOT NULL,
  enqueued_at       INTEGER NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   INTEGER NOT NULL,
  last_attempt_at   INTEGER,
  last_error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_next_attempt ON outbox(next_attempt_at ASC, enqueued_at ASC);
CREATE INDEX IF NOT EXISTS idx_outbox_room ON outbox(room_id);
